import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function cors(json: any, init?: ResponseInit) {
  return NextResponse.json(json, {
    ...(init || {}),
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
      ...(init?.headers || {}),
    },
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
    if (!token) return cors({ error: "Missing Authorization Bearer token" }, { status: 401 });

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!url || !anon) {
      return cors({ error: "Missing Supabase env (URL/ANON)" }, { status: 500 });
    }

    // Client com RLS (usa token do usuário)
    const supa = createClient(url, anon, {
      global: {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
      auth: {
        persistSession: false,
      },
    });

    // 1) quem é o usuário?
    const { data: userRes, error: userErr } = await supa.auth.getUser();
    if (userErr || !userRes?.user) {
      return cors({ error: "Invalid session" }, { status: 401 });
    }

    const user_id = userRes.user.id;

    // 2) pega tenant
    const { data: tu, error: tuErr } = await supa
      .from("movyads_tenant_users")
      .select("tenant_id")
      .eq("user_id", user_id)
      .limit(1)
      .single();

    if (tuErr || !tu?.tenant_id) {
      return cors({ error: "User has no tenant" }, { status: 400 });
    }

    const tenant_id = tu.tenant_id as string;

    // 3) últimos 7 dias (incluindo hoje)
    const end = new Date();
    const start = new Date();
    start.setDate(end.getDate() - 6);

    const startStr = isoDate(start);
    const endStr = isoDate(end);

    // 4) busca rows do insights_daily
    // esperados: tenant_id, date, spend, clicks, impressions, ctr, cpc, cpm
    const { data: rows, error: rowsErr } = await supa
      .from("movyads_insights_daily")
      .select("date, spend, clicks, impressions, ctr, cpc, cpm")
      .eq("tenant_id", tenant_id)
      .gte("date", startStr)
      .lte("date", endStr);

    if (rowsErr) {
      return cors({ error: rowsErr.message }, { status: 500 });
    }

    const list = (rows || []) as any[];

    // 5) agrega por dia
    const byDate = new Map<
      string,
      { spend: number; clicks: number; impressions: number }
    >();

    for (const r of list) {
      const d = String(r.date || "").slice(0, 10);
      if (!d) continue;

      const curr = byDate.get(d) || { spend: 0, clicks: 0, impressions: 0 };

      curr.spend += safeNum(r.spend);
      curr.clicks += safeNum(r.clicks);
      curr.impressions += safeNum(r.impressions);

      byDate.set(d, curr);
    }

    // 6) garante os 7 dias no chart (mesmo que não tenha dado)
    const chart: { date: string; spend: number; clicks: number; impressions: number }[] = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      const key = isoDate(d);

      const v = byDate.get(key) || { spend: 0, clicks: 0, impressions: 0 };
      chart.push({ date: key, spend: v.spend, clicks: v.clicks, impressions: v.impressions });
    }

    // 7) totals e médias
    const totalsSpend = chart.reduce((a, x) => a + safeNum(x.spend), 0);
    const totalsClicks = chart.reduce((a, x) => a + safeNum(x.clicks), 0);
    const totalsImp = chart.reduce((a, x) => a + safeNum(x.impressions), 0);

    // CTR (%) = clicks/impressions * 100
    const ctr = totalsImp > 0 ? (totalsClicks / totalsImp) * 100 : 0;

    // CPC = spend/clicks
    const cpc = totalsClicks > 0 ? totalsSpend / totalsClicks : 0;

    // CPM = spend/impressions * 1000
    const cpm = totalsImp > 0 ? (totalsSpend / totalsImp) * 1000 : 0;

    return cors({
      ok: true,
      totals: {
        spend: totalsSpend,
        impressions: totalsImp,
        clicks: totalsClicks,
        ctr,
        cpc,
        cpm,
      },
      chart,
    });
  } catch (e: any) {
    return cors({ error: String(e?.message || e) }, { status: 500 });
  }
}
