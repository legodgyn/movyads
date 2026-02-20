import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function json(data: any, status = 200) {
  return NextResponse.json(data, { status, headers: { "cache-control": "no-store" } });
}

function getBearer(req: Request) {
  const h = req.headers.get("authorization") || req.headers.get("Authorization") || "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m?.[1] || null;
}

function isoDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

function safeNum(v: any) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export async function GET(req: Request) {
  try {
    const token = getBearer(req);
    if (!token) return json({ error: "Missing Authorization Bearer token" }, 401);

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !anon) return json({ error: "Missing Supabase env" }, 500);

    const supa = createClient(url, anon, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false },
    });

    const { data: userRes, error: userErr } = await supa.auth.getUser();
    if (userErr || !userRes?.user) return json({ error: "Invalid session" }, 401);

    const { data: tu, error: tuErr } = await supa
      .from("movyads_tenant_users")
      .select("tenant_id")
      .eq("user_id", userRes.user.id)
      .limit(1)
      .single();

    if (tuErr || !tu?.tenant_id) return json({ error: "User has no tenant" }, 400);
    const tenant_id = tu.tenant_id as string;

    const { searchParams } = new URL(req.url);
    const account_id = searchParams.get("account_id");
    if (!account_id) return json({ error: "Missing account_id" }, 400);

    const end = new Date();
    const start = new Date();
    start.setDate(end.getDate() - 6);

    const startStr = isoDate(start);
    const endStr = isoDate(end);

    const { data: rows, error } = await supa
      .from("movyads_insights_daily")
      .select("entity_external_id, entity_name, spend, impressions, clicks")
      .eq("tenant_id", tenant_id)
      .eq("account_id", account_id)
      .eq("level", "campaign")
      .gte("date", startStr)
      .lte("date", endStr);

    if (error) return json({ error: error.message }, 500);

    const list = (rows || []) as any[];

    const agg = new Map<
      string,
      { name: string | null; spend: number; impressions: number; clicks: number }
    >();

    for (const r of list) {
      const id = String(r.entity_external_id || "");
      if (!id) continue;
      const curr = agg.get(id) || {
        name: r.entity_name ? String(r.entity_name) : null,
        spend: 0,
        impressions: 0,
        clicks: 0,
      };

      // se vier nome em alguma linha, guarda
      if (!curr.name && r.entity_name) curr.name = String(r.entity_name);

      curr.spend += safeNum(r.spend);
      curr.impressions += safeNum(r.impressions);
      curr.clicks += safeNum(r.clicks);
      agg.set(id, curr);
    }

    const out = Array.from(agg.entries()).map(([campaign_id, x]) => {
      const ctr = x.impressions > 0 ? (x.clicks / x.impressions) * 100 : 0;
      const cpc = x.clicks > 0 ? x.spend / x.clicks : 0;
      const cpm = x.impressions > 0 ? (x.spend / x.impressions) * 1000 : 0;

      return {
        campaign_id,
        campaign_name: x.name,
        spend: x.spend,
        impressions: x.impressions,
        clicks: x.clicks,
        ctr,
        cpc,
        cpm,
      };
    });

    out.sort((a, b) => b.spend - a.spend);

    return json({ ok: true, start: startStr, end: endStr, rows: out });
  } catch (e: any) {
    return json({ error: String(e?.message || e) }, 500);
  }
}
