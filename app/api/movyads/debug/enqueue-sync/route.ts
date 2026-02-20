import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

function mustEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Falta ${name} no .env.local`);
  return v;
}

export async function GET() {
  try {
    const supabaseUrl = mustEnv("NEXT_PUBLIC_SUPABASE_URL");
    const serviceKey = mustEnv("SUPABASE_SERVICE_ROLE_KEY");
    const supabase = createClient(supabaseUrl, serviceKey);

    // pega a conta mais recente
    const { data: acct, error: acctErr } = await supabase
      .from("movyads_ad_accounts")
      .select("id, external_id")
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    if (acctErr || !acct?.id) {
      return NextResponse.json(
        { error: `Nenhuma conta encontrada em movyads_ad_accounts: ${acctErr?.message || "?"}` },
        { status: 400 }
      );
    }

    const days = Number(process.env.MOVYADS_SYNC_DAYS_DEFAULT || 7) || 7;

    const payload = {
      ad_account_row_id: acct.id,
      external_id: acct.external_id,
      days,
    };

    const { data: job, error: jobErr } = await supabase
      .from("movyads_job_queue")
      .insert([{ status: "pending", job_type: "SYNC_META_TODAY", payload }])
      .select("id")
      .single();

    if (jobErr) {
      return NextResponse.json({ error: jobErr.message }, { status: 400 });
    }

    return NextResponse.json({ ok: true, job_id: job?.id, payload });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500 });
  }
}
