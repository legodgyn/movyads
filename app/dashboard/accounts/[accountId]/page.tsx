"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabaseBrowser";

type Row = {
  campaign_id: string;
  campaign_name: string | null;
  spend: number;
  impressions: number;
  clicks: number;
  ctr: number;
  cpc: number;
  cpm: number;
};

type Resp = {
  ok: boolean;
  start: string;
  end: string;
  rows: Row[];
};

function formatBRL(v: number) {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export default function AccountCampaignsPage() {
  const params = useParams<{ accountId: string }>();
  const accountId = params.accountId;

  const [data, setData] = useState<Resp | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const title = useMemo(() => `Campanhas — Conta ${accountId}`, [accountId]);

  useEffect(() => {
    async function run() {
      setLoading(true);
      setErr(null);

      const { data: sessionRes } = await supabase.auth.getSession();
      const token = sessionRes.session?.access_token;

      if (!token) {
        setErr("Sessão inválida (sem token).");
        setLoading(false);
        return;
      }

      const res = await fetch(`/api/movyads/campaigns/summary?account_id=${encodeURIComponent(accountId)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      const json = await res.json();

      if (!res.ok) {
        setErr(json?.error || "Erro carregando campanhas.");
        setLoading(false);
        return;
      }

      setData(json as Resp);
      setLoading(false);
    }

    run();
  }, [accountId]);

  return (
    <div className="min-h-screen bg-black p-8 text-white">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">{title}</h1>
          <p className="mt-2 text-white/60 text-sm">
            Ranking por spend (últimos 7 dias). Atualize se estiver vazio.
          </p>
        </div>

        <Link
          href="/dashboard"
          className="rounded bg-zinc-700 px-4 py-2 hover:bg-zinc-600 transition"
        >
          Voltar
        </Link>
      </div>

      <div className="mt-6 rounded-xl bg-zinc-900 p-4">
        {loading ? (
          <div className="text-white/70">Carregando...</div>
        ) : err ? (
          <div className="text-red-300">{err}</div>
        ) : (data?.rows?.length || 0) === 0 ? (
          <div className="text-white/70">
            Sem dados. Clique “Sincronizar”.
          </div>
        ) : (
          <>
            <div className="text-xs text-white/50 mb-3">
              Período: {data?.start} → {data?.end}
            </div>

            <div className="overflow-auto rounded-lg border border-white/10">
              <table className="min-w-full text-sm">
                <thead className="bg-white/5">
                  <tr>
                    <th className="p-3 text-left">Campanha</th>
                    <th className="p-3 text-right">Spend</th>
                    <th className="p-3 text-right">Cliques</th>
                    <th className="p-3 text-right">CTR</th>
                    <th className="p-3 text-right">CPC</th>
                    <th className="p-3 text-right">CPM</th>
                  </tr>
                </thead>
                <tbody>
                  {data?.rows?.slice(0, 50).map((r) => (
                    <tr key={r.campaign_id} className="border-t border-white/10">
                      <td className="p-3">
                        <div className="font-semibold">
                          {r.campaign_name || "(sem nome)"}
                        </div>
                        <div className="text-xs text-white/50">{r.campaign_id}</div>
                      </td>
                      <td className="p-3 text-right">{formatBRL(r.spend || 0)}</td>
                      <td className="p-3 text-right">
                        {(r.clicks || 0).toLocaleString("pt-BR")}
                      </td>
                      <td className="p-3 text-right">{(r.ctr || 0).toFixed(2)}%</td>
                      <td className="p-3 text-right">{formatBRL(r.cpc || 0)}</td>
                      <td className="p-3 text-right">{formatBRL(r.cpm || 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
