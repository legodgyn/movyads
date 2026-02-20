import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function json(data: any, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: { "cache-control": "no-store" },
  });
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

    const end = new Date();
    const start = new Date();
    start.setDate(end.getDate() - 6);

    const startStr = isoDate(start);
    const endStr = isoDate(end);

    // pega contas
    const { data: accounts, error: accErr } = await supa
      .from("movyads_ad_accounts")
      .select("id, external_id, name, status, platform")
      .eq("platform", "meta")
      .order("created_at", { ascending: false });

    if (accErr) return json({ error: accErr.message }, 500);

    // pega insights do período (todas as contas)
    const { data: rows, error: rErr } = await supa
      .from("movyads_insights_daily")
      .select("account_id, spend, impressions, clicks")
      .eq("tenant_id", tenant_id)
      .gte("date", startStr)
      .lte("date", endStr);

    if (rErr) return json({ error: rErr.message }, 500);

    const list = (rows || []) as any[];

    // agrega por account_id (UUID FK)
    const agg = new Map<
      string,
      { spend: number; impressions: number; clicks: number }
    >();

    for (const r of list) {
      const id = String(r.account_id || "");
      if (!id) continue;
      const curr = agg.get(id) || { spend: 0, impressions: 0, clicks: 0 };
      curr.spend += safeNum(r.spend);
      curr.impressions += safeNum(r.impressions);
      curr.clicks += safeNum(r.clicks);
      agg.set(id, curr);
    }

    const out = (accounts || []).map((a: any) => {
      const x = agg.get(a.id) || { spend: 0, impressions: 0, clicks: 0 };
      const ctr = x.impressions > 0 ? (x.clicks / x.impressions) * 100 : 0;
      const cpc = x.clicks > 0 ? x.spend / x.clicks : 0;
      const cpm = x.impressions > 0 ? (x.spend / x.impressions) * 1000 : 0;

      return {
        id: a.id,
        external_id: a.external_id,
        name: a.name,
        status: a.status,
        platform: a.platform,
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
