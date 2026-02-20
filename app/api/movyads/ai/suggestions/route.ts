import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";

export const dynamic = "force-dynamic";

function mustEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Falta ${name} no .env.local`);
  return v;
}

function parseDays(v: any) {
  const n = Number(v || 7);
  if (!Number.isFinite(n)) return 7;
  if (n <= 0) return 7;
  if (n > 90) return 90;
  return Math.floor(n);
}

function daysAgoISO(days: number) {
  const d = new Date();
  d.setDate(d.getDate() - (days - 1)); // inclui hoje
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export async function POST(req: Request) {
  try {
    const supabaseUrl = mustEnv("NEXT_PUBLIC_SUPABASE_URL");
    const serviceKey = mustEnv("SUPABASE_SERVICE_ROLE_KEY");
    const openaiKey = mustEnv("OPENAI_API_KEY");

    const supabase = createClient(supabaseUrl, serviceKey);
    const openai = new OpenAI({ apiKey: openaiKey });

    const body = await req.json().catch(() => ({}));
    const days = parseDays(body?.days);
    const accountId = String(body?.account_id || "all"); // movyads_ad_accounts.id (uuid) ou "all"
    const goal = String(body?.goal || "leads"); // "leads" | "ecommerce" | "awareness" etc

    // tenant atual (no seu setup dev é 1 tenant)
    const { data: tenantRow, error: tenantErr } = await supabase
      .from("movyads_tenants")
      .select("id, name")
      .limit(1)
      .single();

    if (tenantErr || !tenantRow?.id) {
      return NextResponse.json(
        { error: `Tenant não encontrado: ${tenantErr?.message || "?"}` },
        { status: 400 }
      );
    }

    const start = daysAgoISO(days);

    // 1) Top campanhas (agregado por campanha)
    let q = supabase
      .from("movyads_campaign_insights_daily")
      .select("spend, impressions, clicks, campaign_id, day, ad_account_id")
      .eq("tenant_id", tenantRow.id)
      .gte("day", start);

    if (accountId !== "all") q = q.eq("ad_account_id", accountId);

    const { data: insights, error: insErr } = await q;
    if (insErr) return NextResponse.json({ error: insErr.message }, { status: 400 });

    // agrega
    const byCamp = new Map<
      string,
      { spend: number; impressions: number; clicks: number }
    >();

    for (const r of insights || []) {
      const k = String(r.campaign_id);
      const cur = byCamp.get(k) || { spend: 0, impressions: 0, clicks: 0 };
      cur.spend += Number(r.spend || 0);
      cur.impressions += Number(r.impressions || 0);
      cur.clicks += Number(r.clicks || 0);
      byCamp.set(k, cur);
    }

    const campIds = Array.from(byCamp.keys());
    let campNames = new Map<string, string>();

    if (campIds.length) {
      const { data: camps, error: campErr } = await supabase
        .from("movyads_campaigns")
        .select("id, name, external_id")
        .eq("tenant_id", tenantRow.id)
        .in("id", campIds);

      if (campErr) return NextResponse.json({ error: campErr.message }, { status: 400 });

      for (const c of camps || []) {
        campNames.set(String(c.id), String(c.name || c.external_id || c.id));
      }
    }

    const topCampaigns = campIds
      .map((cid) => {
        const agg = byCamp.get(cid)!;
        const impressions = agg.impressions || 0;
        const clicks = agg.clicks || 0;
        const spend = agg.spend || 0;

        const ctr = impressions > 0 ? (clicks / impressions) * 100 : 0;
        const cpc = clicks > 0 ? spend / clicks : 0;

        return {
          campaign_name: campNames.get(cid) || cid,
          spend,
          impressions,
          clicks,
          ctr,
          cpc,
        };
      })
      .sort((a, b) => (b.spend || 0) - (a.spend || 0))
      .slice(0, 10);

    // 2) Totais do período
    const totals = topCampaigns.reduce(
      (acc, c) => {
        acc.spend += c.spend || 0;
        acc.impressions += c.impressions || 0;
        acc.clicks += c.clicks || 0;
        return acc;
      },
      { spend: 0, impressions: 0, clicks: 0 }
    );

    const ctr = totals.impressions > 0 ? (totals.clicks / totals.impressions) * 100 : 0;
    const cpc = totals.clicks > 0 ? totals.spend / totals.clicks : 0;
    const cpm = totals.impressions > 0 ? (totals.spend / totals.impressions) * 1000 : 0;

    // 3) Monta input “curto” (economiza tokens)
    const aiInput = {
      workspace: tenantRow.name || "movyads",
      goal,
      period_days: days,
      account_id: accountId === "all" ? null : accountId,
      totals: { ...totals, ctr, cpc, cpm },
      top_campaigns: topCampaigns,
      notes: [
        "Foque em ações práticas e priorizadas.",
        "Sugira testes A/B de criativo/copy/landing.",
        "Inclua checklist de Pixel/CAPI para melhorar tracking.",
        "Evite recomendações genéricas; use os números acima.",
      ],
    };

    // 4) Chama OpenAI (Responses API)
    // Docs: usar responses.create com model e instructions/input. :contentReference[oaicite:1]{index=1}
    const resp = await openai.responses.create({
      model: "gpt-5",
      reasoning: { effort: "low" },
      instructions:
        "Você é um especialista em tráfego pago (Meta Ads). Gere recomendações objetivas, em português do Brasil. " +
        "Responda em JSON no formato: {summary: string, priorities: Array<{title:string, why:string, how:string, expected_impact:string}>, " +
        "creative_ideas: string[], tracking_checklist: string[], risks: string[]}.",
      input: JSON.stringify(aiInput),
    });

    // resp.output_text traz o texto final (no nosso caso: JSON). :contentReference[oaicite:2]{index=2}
    const text = resp.output_text || "";

    // tenta parsear JSON, se falhar devolve texto
    try {
      const parsed = JSON.parse(text);
      return NextResponse.json({ ok: true, data: parsed, raw: null });
    } catch {
      return NextResponse.json({ ok: true, data: null, raw: text });
    }
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500 });
  }
}
