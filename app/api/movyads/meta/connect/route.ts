import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function POST(req: Request) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

    const auth = req.headers.get("authorization") || "";
    const token = auth.toLowerCase().startsWith("bearer ")
      ? auth.slice(7).trim()
      : "";

    if (!token) return NextResponse.json({ error: "Missing bearer token" }, { status: 401 });

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });

    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData.user) {
      return NextResponse.json({ error: "Invalid token" }, { status: 401 });
    }

    const body = await req.json();
    const access_token = String(body.access_token || "");
    const meta_user_id = String(body.meta_user_id || "");
    const expires_in = Number(body.expires_in || 0);

    if (!access_token || !meta_user_id) {
      return NextResponse.json({ error: "Missing meta token/user id" }, { status: 400 });
    }

    const admin = createClient(supabaseUrl, serviceKey);

    // pega tenant do user
    const { data: tu, error: tuErr } = await admin
      .from("movyads_tenant_users")
      .select("tenant_id")
      .eq("user_id", userData.user.id)
      .limit(1)
      .single();

    if (tuErr || !tu) return NextResponse.json({ error: "User has no tenant" }, { status: 400 });

    const tenant_id = tu.tenant_id;

    // upsert conexão
    const expiresAt =
      expires_in > 0 ? new Date(Date.now() + expires_in * 1000).toISOString() : null;

    const { error: upErr } = await admin.from("movyads_meta_connections").upsert(
      {
        tenant_id,
        meta_user_id,
        access_token,
        token_expires_at: expiresAt,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "tenant_id" }
    );

    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

    // Importar ad accounts do usuário
    const accountsRes = await fetch(
      `https://graph.facebook.com/v20.0/me/adaccounts?fields=id,name,account_status&access_token=${encodeURIComponent(
        access_token
      )}`
    );
    const accountsJson: any = await accountsRes.json();

    if (!accountsRes.ok) {
      return NextResponse.json(
        { error: accountsJson?.error?.message || "Failed fetching adaccounts" },
        { status: 400 }
      );
    }

    const rows = (accountsJson.data || []).map((a: any) => ({
      tenant_id,
      platform: "meta",
      external_id: a.id, // normalmente vem como act_...
      name: a.name || null,
      status: String(a.account_status ?? ""),
    }));

    if (rows.length > 0) {
      const { error: insErr } = await admin.from("movyads_ad_accounts").upsert(rows, {
        onConflict: "tenant_id,platform,external_id",
      });

      if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, imported: rows.length });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Unknown error" }, { status: 500 });
  }
}
