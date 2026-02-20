import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

function mustEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Falta ${name} no .env.local`);
  return v;
}

export async function POST(req: Request) {
  try {
    const supabaseUrl = mustEnv("NEXT_PUBLIC_SUPABASE_URL");
    const serviceKey = mustEnv("SUPABASE_SERVICE_ROLE_KEY");
    const supabase = createClient(supabaseUrl, serviceKey);

    const body = await req.json().catch(() => ({}));
    const ad_account_row_id = String(body?.ad_account_row_id || "").trim();
    const external_id = String(body?.external_id || "").trim();
    const days =
      Number(body?.days) ||
      Number(process.env.MOVYADS_SYNC_DAYS_DEFAULT || 7) ||
      7;

    if (!ad_account_row_id) {
      return NextResponse.json(
        { error: "Falta ad_account_row_id (UUID da tabela movyads_ad_accounts)" },
        { status: 400 }
      );
    }

    // external_id é opcional aqui (mas bom ter pra debug)
    const payload = { ad_account_row_id, external_id, days };

    const { data, error } = await supabase
      .from("movyads_job_queue")
      .insert([{ status: "pending", job_type: "SYNC_META_TODAY", payload }])
      .select("id")
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ ok: true, job_id: data?.id });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500 });
  }
}
