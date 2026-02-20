import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

type JobRow = {
  id: string;
  status: string;
  job_type: string;
  payload: any;
  created_at: string;
};

type AdAccountRow = {
  id: string;
  tenant_id: string;
  external_id: string; // act_...
  name: string | null;
};

type MetaConnRow = {
  id: string;
  tenant_id: string;
  meta_user_id: string;
  access_token: string;
  token_expires_at: string | null;
  expires_at: string | null;
};

type InsightRow = {
  date_start: string; // YYYY-MM-DD
  campaign_id: string;
  campaign_name: string;
  spend: string; // Meta retorna string
  impressions: string;
  clicks: string;
};

function mustEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`❌ Falta ${name} no .env.local`);
  return v;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function chunk<T>(arr: T[], size: number) {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function isoDateDaysAgo(days: number) {
  const d = new Date();
  d.setDate(d.getDate() - (days - 1)); // inclui hoje
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function todayISO() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

async function fetchAll(url: string) {
  const rows: any[] = [];
  let nextUrl: string | null = url;

  // trava de segurança
  let guard = 0;

  while (nextUrl) {
    guard++;
    if (guard > 50) break;

    const res = await fetch(nextUrl);
    const json = await res.json();

    if (!res.ok) {
      const msg = json?.error?.message || JSON.stringify(json);
      throw new Error(`Meta API error: ${msg}`);
    }

    if (Array.isArray(json?.data)) rows.push(...json.data);
    nextUrl = json?.paging?.next || null;
  }

  return rows;
}

async function syncMetaAccount(opts: {
  supabase: ReturnType<typeof createClient>;
  adAccountRowId: string; // UUID
  days: number;
}) {
  const { supabase, adAccountRowId, days } = opts;

  // 1) carrega a conta
  const { data: acct, error: acctErr } = await supabase
    .from("movyads_ad_accounts")
    .select("id, tenant_id, external_id, name")
    .eq("id", adAccountRowId)
    .single();

  if (acctErr || !acct) {
    throw new Error(`Conta não encontrada (${adAccountRowId}): ${acctErr?.message || "?"}`);
  }

  const account = acct as AdAccountRow;

  // 2) pega token da conexão meta do tenant
  const { data: conn, error: connErr } = await supabase
    .from("movyads_meta_connections")
    .select("id, tenant_id, meta_user_id, access_token, token_expires_at, expires_at")
    .eq("tenant_id", account.tenant_id)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  if (connErr || !conn?.access_token) {
    throw new Error(
      `Sem conexão Meta para este workspace (tenant_id=${account.tenant_id}). Conecte a Meta primeiro.`
    );
  }

  const meta = conn as MetaConnRow;

  const graphVersion = process.env.META_GRAPH_VERSION || "v20.0";
  const since = isoDateDaysAgo(days);
  const until = todayISO();

  // 3) busca INSIGHTS por campanha, dia a dia (level=campaign)
  // Campos importantes: date_start, campaign_id, campaign_name, spend, impressions, clicks
  const base = `https://graph.facebook.com/${graphVersion}/${encodeURIComponent(
    account.external_id
  )}/insights`;

  const qs = new URLSearchParams();
  qs.set("level", "campaign");
  qs.set("time_increment", "1");
  qs.set("fields", "date_start,campaign_id,campaign_name,spend,impressions,clicks");
  qs.set("time_range[since]", since);
  qs.set("time_range[until]", until);
  qs.set("limit", "200");
  qs.set("access_token", meta.access_token);

  const url = `${base}?${qs.toString()}`;

  const insights = (await fetchAll(url)) as InsightRow[];

  // se não tem nada, ok
  if (!insights.length) {
    return { imported_campaigns: 0, imported_days: 0 };
  }

  // 4) upsert campanhas
  const uniqueCampaigns = new Map<string, { external_id: string; name: string }>();
  for (const r of insights) {
    if (!r.campaign_id) continue;
    uniqueCampaigns.set(String(r.campaign_id), {
      external_id: String(r.campaign_id),
      name: String(r.campaign_name || r.campaign_id),
    });
  }

  const campaignUpserts = Array.from(uniqueCampaigns.values()).map((c) => ({
    tenant_id: account.tenant_id,
    ad_account_id: account.id,
    external_id: c.external_id,
    name: c.name,
    status: null,
  }));

  // faz upsert em lotes
  for (const part of chunk(campaignUpserts, 200)) {
    const { error } = await supabase
      .from("movyads_campaigns")
      .upsert(part, { onConflict: "tenant_id,external_id" });

    if (error) throw new Error(`Erro upsert campaigns: ${error.message}`);
  }

  // 5) busca ids internos das campanhas (uuid)
  const campaignExternalIds = Array.from(uniqueCampaigns.keys());
  const campaignIdByExternal = new Map<string, string>();

  for (const part of chunk(campaignExternalIds, 200)) {
    const { data, error } = await supabase
      .from("movyads_campaigns")
      .select("id, external_id")
      .eq("tenant_id", account.tenant_id)
      .in("external_id", part);

    if (error) throw new Error(`Erro lendo campaigns: ${error.message}`);
    for (const row of data || []) {
      campaignIdByExternal.set(String(row.external_id), String(row.id));
    }
  }

  // 6) prepara upsert de insights daily
  const insightUpserts = insights
    .map((r) => {
      const internalCampaignId = campaignIdByExternal.get(String(r.campaign_id));
      if (!internalCampaignId) return null;

      const spend = Number(r.spend || 0);
      const impressions = Number(r.impressions || 0);
      const clicks = Number(r.clicks || 0);

      return {
        tenant_id: account.tenant_id,
        ad_account_id: account.id,
        campaign_id: internalCampaignId,
        day: r.date_start,
        spend,
        impressions,
        clicks,
      };
    })
    .filter(Boolean) as any[];

  for (const part of chunk(insightUpserts, 500)) {
    const { error } = await supabase
      .from("movyads_campaign_insights_daily")
      .upsert(part, { onConflict: "tenant_id,campaign_id,day" });

    if (error) throw new Error(`Erro upsert insights_daily: ${error.message}`);
  }

  return {
    imported_campaigns: uniqueCampaigns.size,
    imported_days: insightUpserts.length,
  };
}

async function claimOneJob(supabase: ReturnType<typeof createClient>) {
  // pega o mais antigo pendente
  const { data: jobs, error } = await supabase
    .from("movyads_job_queue")
    .select("id, status, job_type, payload, created_at")
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(1);

  if (error) throw new Error(`Erro lendo job_queue: ${error.message}`);
  const job = (jobs?.[0] || null) as JobRow | null;
  if (!job) return null;

  // tenta “claim” (evita 2 workers pegarem o mesmo job)
  const { data: updated, error: upErr } = await supabase
    .from("movyads_job_queue")
    .update({ status: "processing" })
    .eq("id", job.id)
    .eq("status", "pending")
    .select("id, status, job_type, payload, created_at")
    .single();

  if (upErr) return null;
  return updated as JobRow;
}

async function markJobDone(
  supabase: ReturnType<typeof createClient>,
  jobId: string,
  meta: any
) {
  const payload = { ...(meta || {}) };
  const { error } = await supabase
    .from("movyads_job_queue")
    .update({ status: "done", payload })
    .eq("id", jobId);

  if (error) throw new Error(`Erro marcando job done: ${error.message}`);
}

async function markJobError(
  supabase: ReturnType<typeof createClient>,
  jobId: string,
  err: any
) {
  const msg = String(err?.message || err);
  const { data: row } = await supabase
    .from("movyads_job_queue")
    .select("payload")
    .eq("id", jobId)
    .single();

  const payload = { ...(row?.payload || {}), error: msg };
  const { error } = await supabase
    .from("movyads_job_queue")
    .update({ status: "error", payload })
    .eq("id", jobId);

  if (error) throw new Error(`Erro marcando job error: ${error.message}`);
}

async function runOnce(supabase: ReturnType<typeof createClient>) {
  const job = await claimOneJob(supabase);
  if (!job) {
    return { ok: true, message: "Nenhum job pendente" };
  }

  try {
    if (job.job_type === "SYNC_META_TODAY") {
      const adAccountRowId = String(job.payload?.ad_account_row_id || "");
      const days =
        Number(job.payload?.days) ||
        Number(process.env.MOVYADS_SYNC_DAYS_DEFAULT || 7) ||
        7;

      if (!adAccountRowId) throw new Error("payload sem ad_account_row_id");

      const result = await syncMetaAccount({
        supabase,
        adAccountRowId,
        days,
      });

      await markJobDone(supabase, job.id, {
        ...job.payload,
        result,
        finished_at: new Date().toISOString(),
      });

      return { ok: true, job_id: job.id, ...result };
    }

    // job desconhecido
    await markJobError(supabase, job.id, `Job type desconhecido: ${job.job_type}`);
    return { ok: false, job_id: job.id, error: "job type desconhecido" };
  } catch (e) {
    await markJobError(supabase, job.id, e);
    return { ok: false, job_id: job.id, error: String((e as any)?.message || e) };
  }
}

async function main() {
  const supabaseUrl = mustEnv("NEXT_PUBLIC_SUPABASE_URL");
  const serviceKey = mustEnv("SUPABASE_SERVICE_ROLE_KEY");

  const interval =
    Number(process.env.MOVYADS_WORKER_INTERVAL_MS || 60000) || 60000;

  const supabase = createClient(supabaseUrl, serviceKey);

  console.log("✅ movyads worker ON");
  console.log(`⏱️ Interval: ${interval}ms`);

  while (true) {
    try {
      const r = await runOnce(supabase);
      if (r?.message) {
        // silencioso
      } else {
        console.log("✅ job processed:", r);
      }
    } catch (e) {
      console.error("❌ worker loop error:", e);
    }

    await sleep(interval);
  }
}

main().catch((e) => {
  console.error("❌ worker fatal:", e);
  process.exit(1);
});
