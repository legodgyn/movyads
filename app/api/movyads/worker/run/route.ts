import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

function mustEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Falta ${name} no .env.local`);
  return v;
}

async function claimOneJob(supabase: any) {
  const { data: jobs, error } = await supabase
    .from("movyads_job_queue")
    .select("id, status, job_type, payload, created_at")
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(1);

  if (error) throw new Error(error.message);
  const job = jobs?.[0];
  if (!job) return null;

  const { data: updated, error: upErr } = await supabase
    .from("movyads_job_queue")
    .update({ status: "processing" })
    .eq("id", job.id)
    .eq("status", "pending")
    .select("id, status, job_type, payload, created_at")
    .single();

  if (upErr) return null;
  return updated;
}

export async function GET() {
  return run();
}

export async function POST() {
  return run();
}

async function run() {
  try {
    const supabaseUrl = mustEnv("NEXT_PUBLIC_SUPABASE_URL");
    const serviceKey = mustEnv("SUPABASE_SERVICE_ROLE_KEY");
    const supabase = createClient(supabaseUrl, serviceKey);

    const job = await claimOneJob(supabase);
    if (!job) return NextResponse.json({ message: "Nenhum job pendente" });

    // Não executa a sync aqui (quem executa é o scripts/worker.ts),
    // apenas “claim” para debug.
    return NextResponse.json({ ok: true, claimed_job: job.id, job_type: job.job_type });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500 });
  }
}
