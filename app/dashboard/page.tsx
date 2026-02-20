"use client";

import Link from "next/link";
import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseBrowser";
import { useRouter } from "next/navigation";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";

type AdAccountRow = {
  id: string; // UUID no Supabase
  external_id: string; // act_...
  name: string | null;
  status: string | null;
  platform: "meta";
};

type MetricsResponse = {
  ok: boolean;
  totals: {
    spend: number;
    impressions: number;
    clicks: number;
    ctr: number;
    cpc: number;
    cpm: number;
  };
  chart: { date: string; spend: number; clicks: number; impressions: number }[];
};

type AccountSummaryRow = {
  id: string;
  external_id: string;
  name: string | null;
  status: string | null;
  platform: "meta";
  spend: number;
  impressions: number;
  clicks: number;
  ctr: number;
  cpc: number;
  cpm: number;
};

type AccountSummaryResponse = {
  ok: boolean;
  start: string;
  end: string;
  rows: AccountSummaryRow[];
};

type TopCampaignRow = {
  campaign_id: string;
  campaign_name: string;
  spend: number;
  impressions: number;
  clicks: number;
  ctr: number;
  cpc: number;
};

type TopCampaignsResponse = {
  ok: boolean;
  days: number;
  account_id: string | null;
  rows: TopCampaignRow[];
};

type AiPayload = {
  summary: string;
  priorities: { title: string; why: string; how: string; expected_impact: string }[];
  creative_ideas: string[];
  tracking_checklist: string[];
  risks: string[];
};

function formatBRL(v: number) {
  return (v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function fmtInt(v: number) {
  return (v || 0).toLocaleString("pt-BR");
}

function Badge({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "neutral" | "good" | "warn" | "bad" | "brand";
}) {
  const cls =
    tone === "good"
      ? "bg-emerald-500/10 text-emerald-200 ring-emerald-500/20"
      : tone === "warn"
      ? "bg-amber-500/10 text-amber-200 ring-amber-500/20"
      : tone === "bad"
      ? "bg-red-500/10 text-red-200 ring-red-500/20"
      : tone === "brand"
      ? "bg-blue-500/10 text-blue-200 ring-blue-500/20"
      : "bg-white/5 text-white/70 ring-white/10";

  return (
    <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs ring-1 ${cls}`}>
      {children}
    </span>
  );
}

function Card({
  title,
  subtitle,
  right,
  children,
}: {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl bg-white/[0.04] ring-1 ring-white/10 backdrop-blur">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-5 py-4">
        <div>
          <div className="text-sm font-semibold text-white/90">{title}</div>
          {subtitle ? <div className="mt-1 text-xs text-white/50">{subtitle}</div> : null}
        </div>
        {right ? <div className="flex items-center gap-2">{right}</div> : null}
      </div>
      <div className="px-5 py-4">{children}</div>
    </div>
  );
}

function Segmented({
  value,
  onChange,
  options,
}: {
  value: number;
  onChange: (v: number) => void;
  options: { label: string; value: number }[];
}) {
  return (
    <div className="inline-flex rounded-xl bg-white/5 p-1 ring-1 ring-white/10">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            onClick={() => onChange(o.value)}
            className={[
              "rounded-lg px-3 py-1.5 text-xs font-semibold transition",
              active ? "bg-white/10 text-white" : "text-white/60 hover:text-white",
            ].join(" ")}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function Modal({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[999]">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      <div className="absolute left-1/2 top-1/2 w-[92vw] max-w-3xl -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-[#0b0b18] ring-1 ring-white/10 shadow-2xl">
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
          <div className="text-sm font-semibold text-white/90">{title}</div>
          <button
            onClick={onClose}
            className="rounded-lg bg-white/10 px-3 py-1.5 text-xs font-semibold hover:bg-white/15 transition"
          >
            Fechar
          </button>
        </div>
        <div className="max-h-[75vh] overflow-auto px-5 py-4">{children}</div>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const router = useRouter();

  const [email, setEmail] = useState<string | null>(null);
  const [tenantName, setTenantName] = useState<string | null>(null);
  const [status, setStatus] = useState<string>("Carregando...");

  const [accounts, setAccounts] = useState<AdAccountRow[]>([]);
  const [loadingAccounts, setLoadingAccounts] = useState(false);

  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [syncAllLoading, setSyncAllLoading] = useState(false);

  const [metrics, setMetrics] = useState<MetricsResponse | null>(null);
  const [loadingMetrics, setLoadingMetrics] = useState(false);
  const [metricsErr, setMetricsErr] = useState<string | null>(null);

  // ranking
  const [summary, setSummary] = useState<AccountSummaryResponse | null>(null);
  const [loadingSummary, setLoadingSummary] = useState(false);
  const [summaryErr, setSummaryErr] = useState<string | null>(null);

  // filters
  const [days, setDays] = useState<number>(7);
  const [accountFilter, setAccountFilter] = useState<string>("all"); // "all" | ad_account_row_id
  const [accountUiOpen, setAccountUiOpen] = useState(false);

  // auto refresh countdown
  const [countdown, setCountdown] = useState(30);

  // top campaigns
  const [top, setTop] = useState<TopCampaignsResponse | null>(null);
  const [loadingTop, setLoadingTop] = useState(false);
  const [topErr, setTopErr] = useState<string | null>(null);

  // ✅ IA
  const [goal, setGoal] = useState<"leads" | "ecommerce">("leads");
  const [aiOpen, setAiOpen] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiErr, setAiErr] = useState<string | null>(null);
  const [aiData, setAiData] = useState<AiPayload | null>(null);
  const [aiRaw, setAiRaw] = useState<string | null>(null);

  async function getTokenOrThrow() {
    const { data: sessionRes } = await supabase.auth.getSession();
    const token = sessionRes.session?.access_token;
    if (!token) throw new Error("Sessão inválida (sem token).");
    return token;
  }

  async function loadAccounts() {
    setLoadingAccounts(true);
    setSyncMsg(null);

    const { data, error } = await supabase
      .from("movyads_ad_accounts")
      .select("id, external_id, name, status, platform")
      .order("created_at", { ascending: false });

    setLoadingAccounts(false);

    if (error) {
      setSyncMsg(`Erro carregando contas: ${error.message}`);
      return;
    }

    setAccounts((data || []) as AdAccountRow[]);
  }

  async function loadMetrics() {
    setLoadingMetrics(true);
    setMetricsErr(null);

    let token: string;
    try {
      token = await getTokenOrThrow();
    } catch (e: any) {
      setLoadingMetrics(false);
      setMetricsErr(String(e?.message || e));
      return;
    }

    const qs = new URLSearchParams();
    qs.set("days", String(days));
    if (accountFilter !== "all") qs.set("account_id", accountFilter);

    const res = await fetch(`/api/movyads/metrics?${qs.toString()}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    });

    const json = await res.json();

    setLoadingMetrics(false);

    if (!res.ok) {
      setMetricsErr(json?.error || "Erro ao carregar métricas.");
      return;
    }

    setMetrics(json as MetricsResponse);
  }

  async function loadSummary() {
    setLoadingSummary(true);
    setSummaryErr(null);

    let token: string;
    try {
      token = await getTokenOrThrow();
    } catch (e: any) {
      setLoadingSummary(false);
      setSummaryErr(String(e?.message || e));
      return;
    }

    const qs = new URLSearchParams();
    qs.set("days", String(days));

    const res = await fetch(`/api/movyads/accounts/summary?${qs.toString()}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    });

    const json = await res.json();

    setLoadingSummary(false);

    if (!res.ok) {
      setSummaryErr(json?.error || "Erro ao carregar ranking.");
      return;
    }

    setSummary(json as AccountSummaryResponse);
  }

  async function loadTopCampaigns() {
    setLoadingTop(true);
    setTopErr(null);

    let token: string;
    try {
      token = await getTokenOrThrow();
    } catch (e: any) {
      setLoadingTop(false);
      setTopErr(String(e?.message || e));
      return;
    }

    const qs = new URLSearchParams();
    qs.set("days", String(days));
    if (accountFilter !== "all") qs.set("account_id", accountFilter);

    const res = await fetch(`/api/movyads/campaigns/top?${qs.toString()}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    });

    const json = await res.json();
    setLoadingTop(false);

    if (!res.ok) {
      setTopErr(json?.error || "Rota /api/movyads/campaigns/top ainda não existe.");
      return;
    }

    setTop(json as TopCampaignsResponse);
  }

  async function enqueueSync(ad_account_row_id: string, external_id: string) {
    const token = await getTokenOrThrow();

    const res = await fetch("/api/movyads/sync/enqueue", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ ad_account_row_id, external_id }),
    });

    const json = await res.json();

    if (!res.ok) {
      throw new Error(json?.error || "Erro desconhecido ao enfileirar.");
    }
  }

  async function syncAll() {
    setSyncAllLoading(true);
    setSyncMsg(null);

    try {
      if (accounts.length === 0) {
        await loadAccounts();
      }

      const list = accounts.length ? accounts : [];

      if (list.length === 0) {
        setSyncMsg("Nenhuma conta para sincronizar.");
        setSyncAllLoading(false);
        return;
      }

      for (const a of list) {
        await enqueueSync(a.id, a.external_id);
      }

      setSyncMsg(`Sync enfileirado ✅ (${list.length} contas). O worker vai processar sozinho.`);
    } catch (e: any) {
      setSyncMsg(`Erro no sync all: ${String(e?.message || e)}`);
    } finally {
      setSyncAllLoading(false);
    }
  }

  // ✅ IA: gerar sugestões
  async function runAi() {
    setAiOpen(true);
    setAiLoading(true);
    setAiErr(null);
    setAiData(null);
    setAiRaw(null);

    let token: string;
    try {
      token = await getTokenOrThrow();
    } catch (e: any) {
      setAiLoading(false);
      setAiErr(String(e?.message || e));
      return;
    }

    try {
      const res = await fetch("/api/movyads/ai/suggestions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          days,
          account_id: accountFilter,
          goal,
        }),
      });

      const json = await res.json();

      if (!res.ok) {
        setAiErr(json?.error || "Erro na IA.");
        setAiLoading(false);
        return;
      }

      if (json?.data) setAiData(json.data as AiPayload);
      if (json?.raw) setAiRaw(String(json.raw));

      setAiLoading(false);
    } catch (e: any) {
      setAiErr(String(e?.message || e));
      setAiLoading(false);
    }
  }

  useEffect(() => {
    let stopTimer: null | (() => void) = null;

    async function run() {
      setStatus("Verificando sessão...");

      const { data: userRes } = await supabase.auth.getUser();
      if (!userRes.user) {
        router.push("/login");
        return;
      }

      setEmail(userRes.user.email || null);

      let token: string;
      try {
        token = await getTokenOrThrow();
      } catch {
        setStatus("Sessão inválida (sem token).");
        return;
      }

      setStatus("Preparando workspace...");

      const boot = await fetch("/api/movyads/bootstrap", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });

      const bootJson = await boot.json();
      if (!boot.ok) {
        setStatus(`Erro bootstrap: ${bootJson?.error || "desconhecido"}`);
        return;
      }

      setStatus("Carregando workspace...");

      const { data: tenantRows, error } = await supabase
        .from("movyads_tenants")
        .select("name")
        .limit(1);

      if (error) {
        setStatus(`Erro lendo tenant: ${error.message}`);
        return;
      }

      setTenantName(tenantRows?.[0]?.name || null);
      setStatus("OK");

      await loadAccounts();
      await Promise.all([loadMetrics(), loadSummary(), loadTopCampaigns()]);
      setCountdown(30);

      const t = setInterval(() => {
        loadMetrics();
        loadSummary();
        loadTopCampaigns();
        setCountdown(30);
      }, 30000);

      stopTimer = () => clearInterval(t);
    }

    run();

    return () => {
      if (stopTimer) stopTimer();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  useEffect(() => {
    (async () => {
      await Promise.all([loadMetrics(), loadSummary(), loadTopCampaigns()]);
      setCountdown(30);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days, accountFilter]);

  useEffect(() => {
    const c = setInterval(() => {
      setCountdown((p) => (p > 0 ? p - 1 : 0));
    }, 1000);
    return () => clearInterval(c);
  }, []);

  async function logout() {
    await supabase.auth.signOut();
    router.push("/login");
  }

  const totals = metrics?.totals;

  const chartData = useMemo(() => {
    return (metrics?.chart || []).map((x) => ({
      ...x,
      dateLabel: x.date.slice(5).replace("-", "/"),
    }));
  }, [metrics]);

  const statusTone =
    status === "OK"
      ? "good"
      : status.toLowerCase().includes("erro")
      ? "bad"
      : status.toLowerCase().includes("carreg")
      ? "warn"
      : "neutral";

  const selectedAccountLabel = useMemo(() => {
    if (accountFilter === "all") return "Todas as contas";
    const row = accounts.find((a) => a.id === accountFilter);
    if (!row) return "Conta selecionada";
    return row.name ? row.name : row.external_id;
  }, [accountFilter, accounts]);

  return (
    <div className="min-h-screen bg-[#070712] text-white">
      {/* background glow */}
      <div className="pointer-events-none fixed inset-0">
        <div className="absolute -top-24 left-1/2 h-72 w-[900px] -translate-x-1/2 rounded-full bg-blue-600/20 blur-3xl" />
        <div className="absolute top-56 left-1/3 h-64 w-96 rounded-full bg-emerald-500/10 blur-3xl" />
      </div>

      {/* ✅ Sticky Header */}
      <header className="sticky top-0 z-50 border-b border-white/10 bg-[#070712]/70 backdrop-blur">
        <div className="mx-auto w-full max-w-6xl px-4 py-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-bold tracking-tight">Movyads</h1>
                <Badge tone="brand">Dashboard</Badge>
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Badge tone={statusTone as any}>
                  <span className="h-2 w-2 rounded-full bg-current opacity-70" />
                  {status}
                </Badge>

                <Badge>
                  Workspace: <span className="text-white/90">{tenantName || "-"}</span>
                </Badge>

                <Badge>
                  Logado: <span className="text-white/90">{email || "-"}</span>
                </Badge>

                <Badge>
                  Auto: <span className="text-white/90 font-semibold">{countdown}s</span>
                </Badge>
              </div>
            </div>

            {/* Actions + Filters */}
            <div className="flex flex-wrap items-center gap-2">
              <Segmented
                value={days}
                onChange={setDays}
                options={[
                  { label: "7d", value: 7 },
                  { label: "14d", value: 14 },
                  { label: "30d", value: 30 },
                ]}
              />

              {/* seletor de conta */}
              <div className="relative">
                <button
                  onClick={() => setAccountUiOpen((v) => !v)}
                  className="inline-flex items-center gap-2 rounded-xl bg-white/10 px-4 py-2 text-sm font-semibold ring-1 ring-white/10 hover:bg-white/15 transition"
                  title="Filtrar por conta"
                >
                  🎯 {selectedAccountLabel}
                  <span className="text-white/50">▾</span>
                </button>

                {accountUiOpen ? (
                  <div className="absolute right-0 mt-2 w-[320px] overflow-hidden rounded-2xl bg-[#0b0b18] ring-1 ring-white/10 shadow-2xl">
                    <div className="border-b border-white/10 px-4 py-3 text-xs text-white/60">
                      Filtrar por conta
                    </div>

                    <button
                      className={[
                        "w-full px-4 py-3 text-left text-sm hover:bg-white/5 transition",
                        accountFilter === "all" ? "bg-white/5" : "",
                      ].join(" ")}
                      onClick={() => {
                        setAccountFilter("all");
                        setAccountUiOpen(false);
                      }}
                    >
                      Todas as contas
                    </button>

                    <div className="max-h-64 overflow-auto">
                      {accounts.map((a) => (
                        <button
                          key={a.id}
                          className={[
                            "w-full px-4 py-3 text-left text-sm hover:bg-white/5 transition border-t border-white/5",
                            accountFilter === a.id ? "bg-white/5" : "",
                          ].join(" ")}
                          onClick={() => {
                            setAccountFilter(a.id);
                            setAccountUiOpen(false);
                          }}
                        >
                          <div className="font-semibold text-white/90">
                            {a.name || "(sem nome)"}
                          </div>
                          <div className="text-xs text-white/50">{a.external_id}</div>
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>

              <button
                onClick={async () => {
                  await Promise.all([loadMetrics(), loadSummary(), loadTopCampaigns()]);
                  setCountdown(30);
                }}
                className="inline-flex items-center gap-2 rounded-xl bg-white/10 px-4 py-2 text-sm font-semibold ring-1 ring-white/10 hover:bg-white/15 transition"
              >
                ↻ Atualizar
              </button>

              <button
                onClick={loadAccounts}
                className="inline-flex items-center gap-2 rounded-xl bg-white/10 px-4 py-2 text-sm font-semibold ring-1 ring-white/10 hover:bg-white/15 transition disabled:opacity-60"
                disabled={loadingAccounts}
                title="Atualiza a lista de contas importadas"
              >
                {loadingAccounts ? "..." : "Atualizar lista"}
              </button>

              <button
                onClick={syncAll}
                className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold hover:bg-emerald-700 transition disabled:opacity-60"
                disabled={syncAllLoading}
                title="Enfileira sincronização para todas as contas"
              >
                {syncAllLoading ? "..." : "Sincronizar contas"}
              </button>

              <a
                href="/api/meta/login"
                className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold hover:bg-blue-700 transition"
              >
                Ⓜ Conectar Meta
              </a>

              {/* ✅ IA */}
              <div className="inline-flex items-center gap-2 rounded-xl bg-white/5 p-1 ring-1 ring-white/10">
                <button
                  onClick={() => setGoal("leads")}
                  className={[
                    "rounded-lg px-3 py-1.5 text-xs font-semibold transition",
                    goal === "leads" ? "bg-white/10 text-white" : "text-white/60 hover:text-white",
                  ].join(" ")}
                >
                  Lead
                </button>
                <button
                  onClick={() => setGoal("ecommerce")}
                  className={[
                    "rounded-lg px-3 py-1.5 text-xs font-semibold transition",
                    goal === "ecommerce"
                      ? "bg-white/10 text-white"
                      : "text-white/60 hover:text-white",
                  ].join(" ")}
                >
                  E-commerce
                </button>
              </div>

              <button
                onClick={runAi}
                className="inline-flex items-center gap-2 rounded-xl bg-violet-600 px-4 py-2 text-sm font-semibold hover:bg-violet-700 transition"
                title="Gerar sugestões com IA (usa seus dados do período)"
              >
                ✨ IA: Sugestões
              </button>

              <button
                onClick={logout}
                className="inline-flex items-center gap-2 rounded-xl bg-red-600 px-4 py-2 text-sm font-semibold hover:bg-red-700 transition"
              >
                Sair
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Content */}
      <div className="relative mx-auto w-full max-w-6xl px-4 py-8">
        {/* KPI Cards */}
        <div className="grid gap-4 md:grid-cols-4">
          <div className="rounded-2xl bg-white/[0.04] p-5 ring-1 ring-white/10">
            <div className="text-xs text-white/50">Spend ({days}d)</div>
            <div className="mt-2 text-2xl font-bold">
              {totals ? formatBRL(totals.spend) : "—"}
            </div>
            <div className="mt-2 text-xs text-white/40">
              {accountFilter === "all" ? "Soma de todas as contas" : "Apenas conta selecionada"}
            </div>
          </div>

          <div className="rounded-2xl bg-white/[0.04] p-5 ring-1 ring-white/10">
            <div className="text-xs text-white/50">Cliques ({days}d)</div>
            <div className="mt-2 text-2xl font-bold">{totals ? fmtInt(totals.clicks) : "—"}</div>
            <div className="mt-2 text-xs text-white/40">Total no período</div>
          </div>

          <div className="rounded-2xl bg-white/[0.04] p-5 ring-1 ring-white/10">
            <div className="text-xs text-white/50">CTR médio</div>
            <div className="mt-2 text-2xl font-bold">{totals ? `${totals.ctr.toFixed(2)}%` : "—"}</div>
            <div className="mt-2 text-xs text-white/40">Clicks / Impressions</div>
          </div>

          <div className="rounded-2xl bg-white/[0.04] p-5 ring-1 ring-white/10">
            <div className="text-xs text-white/50">CPC médio</div>
            <div className="mt-2 text-2xl font-bold">{totals ? formatBRL(totals.cpc) : "—"}</div>
            <div className="mt-2 text-xs text-white/40">Spend / Clicks</div>
          </div>
        </div>

        {syncMsg ? (
          <div className="mt-6 rounded-2xl bg-white/[0.04] p-4 ring-1 ring-white/10">
            <div className="text-sm text-white/80">{syncMsg}</div>
          </div>
        ) : null}

        {/* ✅ Top campaigns */}
        <div className="mt-6">
          <Card
            title="Top campanhas"
            subtitle={`Top 10 por spend (${days} dias) • ${
              accountFilter === "all" ? "todas as contas" : "conta selecionada"
            }`}
            right={
              <Badge tone={topErr ? "bad" : "neutral"}>
                {loadingTop ? "Carregando..." : topErr ? "Erro" : "OK"}
              </Badge>
            }
          >
            {topErr ? (
              <div className="rounded-xl bg-red-500/10 p-3 text-xs text-red-200 ring-1 ring-red-500/20">
                {topErr}
              </div>
            ) : null}

            <div className="overflow-auto rounded-xl ring-1 ring-white/10">
              <table className="min-w-full text-sm">
                <thead className="bg-white/5 text-white/60">
                  <tr>
                    <th className="px-4 py-3 text-left font-semibold">Campanha</th>
                    <th className="px-4 py-3 text-right font-semibold">Spend</th>
                    <th className="px-4 py-3 text-right font-semibold">Clicks</th>
                    <th className="px-4 py-3 text-right font-semibold">CTR</th>
                    <th className="px-4 py-3 text-right font-semibold">CPC</th>
                  </tr>
                </thead>
                <tbody>
                  {(top?.rows || []).slice(0, 10).map((r) => (
                    <tr key={r.campaign_id} className="border-t border-white/10">
                      <td className="px-4 py-3">
                        <div className="font-semibold text-white/90">{r.campaign_name}</div>
                        <div className="text-xs text-white/40">{r.campaign_id}</div>
                      </td>
                      <td className="px-4 py-3 text-right font-semibold">{formatBRL(r.spend || 0)}</td>
                      <td className="px-4 py-3 text-right">{fmtInt(r.clicks || 0)}</td>
                      <td className="px-4 py-3 text-right">{(r.ctr || 0).toFixed(2)}%</td>
                      <td className="px-4 py-3 text-right">{formatBRL(r.cpc || 0)}</td>
                    </tr>
                  ))}

                  {(top?.rows || []).length === 0 ? (
                    <tr>
                      <td className="px-4 py-6 text-white/60" colSpan={5}>
                        Sem dados ainda. Atualize para sincronizar as contas.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </Card>
        </div>

        {/* Ranking */}
        <div className="mt-6">
          <Card
            title="Ranking por conta"
            subtitle={`Ordenado por spend (maior → menor) • ${days} dias`}
            right={
              summary?.start && summary?.end ? (
                <Badge>
                  Período: <span className="text-white/90">{summary.start}</span> →{" "}
                  <span className="text-white/90">{summary.end}</span>
                </Badge>
              ) : (
                <Badge>—</Badge>
              )
            }
          >
            {summaryErr ? (
              <div className="mb-3 rounded-xl bg-red-500/10 p-3 text-xs text-red-200 ring-1 ring-red-500/20">
                {summaryErr}
              </div>
            ) : null}

            <div className="overflow-auto rounded-xl ring-1 ring-white/10">
              <table className="min-w-full text-sm">
                <thead className="bg-white/5 text-white/60">
                  <tr>
                    <th className="px-4 py-3 text-left font-semibold">Conta</th>
                    <th className="px-4 py-3 text-right font-semibold">Spend</th>
                    <th className="px-4 py-3 text-right font-semibold">Clicks</th>
                    <th className="px-4 py-3 text-right font-semibold">CTR</th>
                    <th className="px-4 py-3 text-right font-semibold">CPC</th>
                    <th className="px-4 py-3 text-right font-semibold">Ação</th>
                  </tr>
                </thead>
                <tbody>
                  {(summary?.rows || []).slice(0, 10).map((r) => (
                    <tr key={r.id} className="border-t border-white/10">
                      <td className="px-4 py-3">
                        <div className="font-semibold text-white/90">{r.name || "(sem nome)"}</div>
                        <div className="text-xs text-white/40">{r.external_id}</div>
                      </td>
                      <td className="px-4 py-3 text-right font-semibold">{formatBRL(r.spend || 0)}</td>
                      <td className="px-4 py-3 text-right">{fmtInt(r.clicks || 0)}</td>
                      <td className="px-4 py-3 text-right">{(r.ctr || 0).toFixed(2)}%</td>
                      <td className="px-4 py-3 text-right">{formatBRL(r.cpc || 0)}</td>
                      <td className="px-4 py-3 text-right">
                        <Link
                          href={`/dashboard/accounts/${r.id}`}
                          className="inline-flex items-center justify-center rounded-xl bg-blue-600 px-3 py-2 text-xs font-semibold hover:bg-blue-700 transition"
                        >
                          Ver campanhas
                        </Link>
                      </td>
                    </tr>
                  ))}

                  {(summary?.rows || []).length === 0 ? (
                    <tr>
                      <td className="px-4 py-6 text-white/60" colSpan={6}>
                        Sem dados ainda. Rode o worker e sincronize as contas.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </Card>
        </div>

        {/* Chart */}
        <div className="mt-6">
          <Card
            title="Spend"
            subtitle={`Soma no período (${days} dias) • ${
              accountFilter === "all" ? "todas as contas" : "conta selecionada"
            }`}
            right={
              <Badge tone={metricsErr ? "bad" : "neutral"}>
                {loadingMetrics ? "Carregando..." : metricsErr ? "Erro" : "OK"}
              </Badge>
            }
          >
            {metricsErr ? (
              <div className="rounded-xl bg-red-500/10 p-3 text-xs text-red-200 ring-1 ring-red-500/20">
                {metricsErr}
              </div>
            ) : null}

            <div className="mt-3 h-80 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="dateLabel" />
                  <YAxis />
                  <Tooltip />
                  <Line type="monotone" dataKey="spend" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </div>

        {/* Accounts list */}
        <div className="mt-6">
          <Card
            title="Ad Accounts (Meta)"
            subtitle="Sincronize individualmente ou use “Sincronizar contas”"
            right={
              <Badge>
                Contas: <span className="text-white/90">{accounts.length}</span>
              </Badge>
            }
          >
            {accounts.length === 0 ? (
              <div className="rounded-xl bg-white/5 p-4 text-sm text-white/70 ring-1 ring-white/10">
                Nenhuma conta importada ainda. Clique em <b>Conectar Meta</b>.
              </div>
            ) : (
              <div className="grid gap-3">
                {accounts.map((a) => (
                  <div key={a.id} className="rounded-2xl bg-black/30 p-4 ring-1 ring-white/10">
                    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="font-semibold text-white/90">{a.name || "(sem nome)"}</div>
                          <Badge>{a.external_id}</Badge>
                          <Badge tone="neutral">Status: {a.status || "-"}</Badge>
                        </div>
                        <div className="mt-1 text-xs text-white/40">ID interno: {a.id}</div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          onClick={async () => {
                            try {
                              setSyncMsg(null);
                              await enqueueSync(a.id, a.external_id);
                              setSyncMsg(`Sync enfileirado ✅ (${a.name || a.external_id})`);
                            } catch (e: any) {
                              setSyncMsg(`Erro enfileirando: ${String(e?.message || e)}`);
                            }
                          }}
                          className="inline-flex items-center justify-center rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold hover:bg-emerald-700 transition"
                        >
                          Sincronizar agora
                        </button>

                        <Link
                          href={`/dashboard/accounts/${a.id}`}
                          className="inline-flex items-center justify-center rounded-xl bg-white/10 px-4 py-2 text-sm font-semibold ring-1 ring-white/10 hover:bg-white/15 transition"
                        >
                          Ver campanhas
                        </Link>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="mt-4 text-xs text-white/45">MovyADS.</div>
          </Card>
        </div>

        <div className="mt-8 text-center text-xs text-white/35">
          Movyads • versão dev • {new Date().getFullYear()}
        </div>
      </div>

      {/* fecha dropdown ao clicar fora */}
      <div
        className="fixed inset-0 z-40"
        onClick={() => setAccountUiOpen(false)}
        style={{ display: accountUiOpen ? "block" : "none" }}
      />

      {/* ✅ Modal IA */}
      <Modal
        open={aiOpen}
        onClose={() => setAiOpen(false)}
        title={`IA • Sugestões (${goal === "leads" ? "Lead" : "E-commerce"} • ${days}d • ${
          accountFilter === "all" ? "todas as contas" : "conta selecionada"
        })`}
      >
        {aiLoading ? (
          <div className="rounded-2xl bg-white/5 p-4 ring-1 ring-white/10">
            <div className="text-sm font-semibold text-white/90">Gerando sugestões...</div>
            <div className="mt-2 text-xs text-white/60">
              Isso usa seus dados (spend/CTR/CPC + top campanhas).
            </div>
          </div>
        ) : aiErr ? (
          <div className="rounded-2xl bg-red-500/10 p-4 text-sm text-red-200 ring-1 ring-red-500/20">
            {aiErr}
          </div>
        ) : aiData ? (
          <div className="space-y-4">
            <div className="rounded-2xl bg-white/5 p-4 ring-1 ring-white/10">
              <div className="text-sm font-semibold text-white/90">Resumo</div>
              <div className="mt-2 text-sm text-white/80">{aiData.summary}</div>
            </div>

            <div className="rounded-2xl bg-white/5 p-4 ring-1 ring-white/10">
              <div className="text-sm font-semibold text-white/90">Prioridades (top)</div>
              <div className="mt-3 space-y-3">
                {aiData.priorities?.slice(0, 6).map((p, idx) => (
                  <div key={idx} className="rounded-xl bg-black/30 p-4 ring-1 ring-white/10">
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-sm font-semibold text-white/90">{p.title}</div>
                      <Badge tone="brand">{p.expected_impact}</Badge>
                    </div>
                    <div className="mt-2 text-xs text-white/60">
                      <b className="text-white/80">Por quê:</b> {p.why}
                    </div>
                    <div className="mt-2 text-xs text-white/60">
                      <b className="text-white/80">Como fazer:</b> {p.how}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-2xl bg-white/5 p-4 ring-1 ring-white/10">
                <div className="text-sm font-semibold text-white/90">Ideias de criativo</div>
                <ul className="mt-3 space-y-2 text-sm text-white/80">
                  {(aiData.creative_ideas || []).slice(0, 10).map((x, i) => (
                    <li key={i} className="rounded-xl bg-black/30 p-3 ring-1 ring-white/10">
                      {x}
                    </li>
                  ))}
                </ul>
              </div>

              <div className="rounded-2xl bg-white/5 p-4 ring-1 ring-white/10">
                <div className="text-sm font-semibold text-white/90">Checklist Pixel/CAPI</div>
                <ul className="mt-3 space-y-2 text-sm text-white/80">
                  {(aiData.tracking_checklist || []).slice(0, 10).map((x, i) => (
                    <li key={i} className="rounded-xl bg-black/30 p-3 ring-1 ring-white/10">
                      {x}
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            <div className="rounded-2xl bg-white/5 p-4 ring-1 ring-white/10">
              <div className="text-sm font-semibold text-white/90">Riscos / alertas</div>
              <ul className="mt-3 space-y-2 text-sm text-white/80">
                {(aiData.risks || []).slice(0, 10).map((x, i) => (
                  <li key={i} className="rounded-xl bg-black/30 p-3 ring-1 ring-white/10">
                    {x}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ) : aiRaw ? (
          <div className="rounded-2xl bg-white/5 p-4 ring-1 ring-white/10">
            <div className="text-sm font-semibold text-white/90">Resposta (raw)</div>
            <pre className="mt-3 whitespace-pre-wrap text-xs text-white/70">{aiRaw}</pre>
          </div>
        ) : (
          <div className="rounded-2xl bg-white/5 p-4 text-sm text-white/70 ring-1 ring-white/10">
            Clique em <b>IA: Sugestões</b> para gerar.
          </div>
        )}
      </Modal>
    </div>
  );
}