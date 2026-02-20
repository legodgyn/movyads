import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

function daysAgoISO(days: number) {
  const d = new Date();
  d.setDate(d.getDate() - (days - 1)); // inclui hoje
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function parseDays(v: string | null) {
  const n = Number(v || 7);
  if (!Number.isFinite(n)) return 7;
  if (n <= 0) return 7;
  if (n > 90) return 90;
  return Math.floor(n);
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const days = parseDays(url.searchParams.get("days"));
    const accountId = url.searchParams.get("account_id"); // movyads_ad_accounts.id (uuid) ou null

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceKey) {
      return NextResponse.json(
        { error: "Falta NEXT_PUBLIC_SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY no .env.local" },
        { status: 500 }
      );
    }

    const supabase = createClient(supabaseUrl, serviceKey);

    // Descobre o tenant atual (no seu setup dev, você usa 1 tenant por usuário)
    const { data: tenantRow, error: tenantErr } = await supabase
      .from("movyads_tenants")
      .select("id")
      .limit(1)
      .single();

    if (tenantErr || !tenantRow?.id) {
      return NextResponse.json(
        { error: `Tenant não encontrado: ${tenantErr?.message || "desconhecido"}` },
        { status: 400 }
      );
    }

    const start = daysAgoISO(days);

    // Busca insights, agrega por campanha
    let query = supabase
      .from("movyads_campaign_insights_daily")
      .select("spend, impressions, clicks, campaign_id, day")
      .eq("tenant_id", tenantRow.id)
      .gte("day", start);

    if (accountId && accountId !== "all") {
      // garante que é uuid plausível
      query = query.eq("ad_account_id", accountId);
    }

    const { data: insights, error: insErr } = await query;

    if (insErr) {
      return NextResponse.json({ error: insErr.message }, { status: 400 });
    }

    const byCampaign = new Map<
      string,
      { spend: number; impressions: number; clicks: number }
    >();

    for (const row of insights || []) {
      const key = String(row.campaign_id);
      const cur = byCampaign.get(key) || { spend: 0, impressions: 0, clicks: 0 };
      cur.spend += Number(row.spend || 0);
      cur.impressions += Number(row.impressions || 0);
      cur.clicks += Number(row.clicks || 0);
      byCampaign.set(key, cur);
    }

    const campaignIds = Array.from(byCampaign.keys());
    if (campaignIds.length === 0) {
      return NextResponse.json({
        ok: true,
        days,
        account_id: accountId && accountId !== "all" ? accountId : null,
        rows: [],
      });
    }

    // Puxa nomes das campanhas
    const { data: campaigns, error: campErr } = await supabase
      .from("movyads_campaigns")
      .select("id, external_id, name")
      .eq("tenant_id", tenantRow.id)
      .in("id", campaignIds);

    if (campErr) {
      return NextResponse.json({ error: campErr.message }, { status: 400 });
    }

    const nameById = new Map<string, string>();
    for (const c of campaigns || []) {
      nameById.set(String(c.id), String(c.name || c.external_id || c.id));
    }

    const rows = campaignIds
      .map((cid) => {
        const agg = byCampaign.get(cid)!;
        const impressions = agg.impressions || 0;
        const clicks = agg.clicks || 0;
        const spend = agg.spend || 0;

        const ctr = impressions > 0 ? (clicks / impressions) * 100 : 0;
        const cpc = clicks > 0 ? spend / clicks : 0;

        return {
          campaign_id: cid,
          campaign_name: nameById.get(cid) || cid,
          spend,
          impressions,
          clicks,
          ctr,
          cpc,
        };
      })
      .sort((a, b) => (b.spend || 0) - (a.spend || 0))
      .slice(0, 10);

    return NextResponse.json({
      ok: true,
      days,
      account_id: accountId && accountId !== "all" ? accountId : null,
      rows,
    });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500 });
  }
}
