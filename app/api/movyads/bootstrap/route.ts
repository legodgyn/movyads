import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function POST(req: Request) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

    if (!supabaseUrl || !anonKey || !serviceKey) {
      return NextResponse.json(
        { error: "Missing Supabase env vars" },
        { status: 500 }
      );
    }

    // token do usuário vindo do client
    const auth = req.headers.get("authorization") || "";
    const token = auth.toLowerCase().startsWith("bearer ")
      ? auth.slice(7).trim()
      : "";

    if (!token) {
      return NextResponse.json({ error: "Missing bearer token" }, { status: 401 });
    }

    // 1) Valida o token com ANON (se token for inválido, não passa)
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });

    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData.user) {
      return NextResponse.json({ error: "Invalid token" }, { status: 401 });
    }

    const user = userData.user;

    // 2) Agora usa SERVICE_ROLE pra mexer no banco (bypass RLS)
    const admin = createClient(supabaseUrl, serviceKey);

    // Já tem tenant?
    const { data: existing, error: exErr } = await admin
      .from("movyads_tenant_users")
      .select("tenant_id, role")
      .eq("user_id", user.id)
      .limit(1);

    if (exErr) {
      return NextResponse.json({ error: exErr.message }, { status: 500 });
    }

    if (existing && existing.length > 0) {
      return NextResponse.json({ ok: true, tenant_id: existing[0].tenant_id });
    }

    // 3) Se não tem tenant, cria um workspace e vincula como owner
    const tenantName =
      (user.email ? `Workspace de ${user.email}` : "Meu Workspace Movyads");

    const { data: tenantRow, error: tErr } = await admin
      .from("movyads_tenants")
      .insert({ name: tenantName })
      .select("id")
      .single();

    if (tErr || !tenantRow) {
      return NextResponse.json({ error: tErr?.message || "Tenant create failed" }, { status: 500 });
    }

    const { error: linkErr } = await admin.from("movyads_tenant_users").insert({
      tenant_id: tenantRow.id,
      user_id: user.id,
      role: "owner",
    });

    if (linkErr) {
      return NextResponse.json({ error: linkErr.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, tenant_id: tenantRow.id });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Unknown error" }, { status: 500 });
  }
}
