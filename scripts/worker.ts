cat > /var/www/movyads/scripts/worker.ts <<'EOF'
import "dotenv/config";

type Json = Record<string, unknown>;

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function mustEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`❌ Falta ${name} no .env.local`);
  return v;
}

async function main() {
  const intervalMs = Number(process.env.MOVYADS_WORKER_INTERVAL_MS || 5000);
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL || "http://127.0.0.1:3010").replace(/\/$/, "");

  // usamos a service role como "token" simples server-to-server (só no servidor)
  const token = mustEnv("SUPABASE_SERVICE_ROLE_KEY");

  console.log("🟢 Movyads Worker iniciado");
  console.log("   app:", appUrl);
  console.log("   interval:", intervalMs, "ms");

  while (true) {
    try {
      let guard = 0;

      while (true) {
        guard++;
        if (guard > 50) break;

        const nextUrl = `${appUrl}/api/movyads/worker/tick`;

        const res: Response = await fetch(nextUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({}),
        });

        let json: Json = {};
        try {
          json = (await res.json()) as Json;
        } catch {
          // ignore
        }

        if (!res.ok) {
          const err = (json as any)?.error || `${res.status} ${res.statusText}`;
          console.error("🔴 tick erro:", err);
          break;
        }

        const status = String((json as any)?.status || "");
        if (status === "empty") {
          // sem jobs
          break;
        }
      }
    } catch (e: any) {
      console.error("🔴 Worker error:", e?.message || e);
    }

    await sleep(intervalMs);
  }
}

main().catch((e) => {
  console.error("❌ Fatal:", e?.message || e);
  process.exit(1);
});
EOF
