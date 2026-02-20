"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseBrowser";

export default function MetaCallbackPage() {
  const router = useRouter();
  const sp = useSearchParams();

  const [status, setStatus] = useState("Lendo retorno da Meta...");
  const [details, setDetails] = useState<string>("");

  const accessToken = useMemo(() => sp.get("access_token"), [sp]);
  const metaUserId = useMemo(() => sp.get("meta_user_id"), [sp]);

  useEffect(() => {
    async function run() {
      try {
        if (!accessToken) {
          setStatus("Erro: access_token não veio na URL.");
          return;
        }

        setStatus("Verificando sessão no Movyads...");
        const { data: userRes } = await supabase.auth.getUser();
        if (!userRes.user) {
          router.push("/login");
          return;
        }

        setStatus("Buscando tenant...");
        const { data: tu, error: tuErr } = await supabase
          .from("movyads_tenant_users")
          .select("tenant_id")
          .eq("user_id", userRes.user.id)
          .limit(1)
          .single();

        if (tuErr || !tu?.tenant_id) {
          setStatus("Erro: usuário sem tenant.");
          setDetails(tuErr?.message || "");
          return;
        }

        const tenant_id = tu.tenant_id;

        setStatus("Trocando token por token LONGO...");
        const ex = await fetch("/api/meta/exchange", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ access_token: accessToken }),
        });

        const exJson = await ex.json();
        if (!ex.ok) {
          setStatus("Erro trocando token.");
          setDetails(exJson?.error || "erro desconhecido");
          return;
        }

        const longToken: string = exJson.access_token;
        const expiresIn = Number(exJson.expires_in || 0);
        const expiresAt = expiresIn
          ? new Date(Date.now() + expiresIn * 1000).toISOString()
          : null;

        setStatus("Salvando conexão no Supabase...");
        const { error: upErr } = await supabase.from("movyads_meta_connections").upsert(
          {
            tenant_id,
            meta_user_id: metaUserId || null,
            access_token: longToken,
            expires_at: expiresAt,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "tenant_id" }
        );

        if (upErr) {
          setStatus("Erro salvando conexão.");
          setDetails(upErr.message);
          return;
        }

        setStatus("Conectado ✅ Redirecionando...");
        setDetails("");

        setTimeout(() => router.push("/dashboard"), 800);
      } catch (e: any) {
        setStatus("Erro inesperado.");
        setDetails(String(e?.message || e));
      }
    }

    run();
  }, [accessToken, metaUserId, router]);

  return (
    <div className="min-h-screen bg-black p-8 text-white">
      <h1 className="text-3xl font-bold">Conectar Meta</h1>
      <p className="mt-4 text-white/80">Status: {status}</p>

      {details ? (
        <pre className="mt-4 whitespace-pre-wrap rounded bg-white/10 p-4 text-sm text-white/80">
          {details}
        </pre>
      ) : null}
    </div>
  );
}
