import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function getBaseUrl(req: Request) {
  return process.env.NEXT_PUBLIC_APP_URL || new URL(req.url).origin;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");
  const errorDescription = url.searchParams.get("error_description");

  if (error) {
    return NextResponse.redirect(
      `${getBaseUrl(req)}/dashboard?meta_error=${encodeURIComponent(
        `${error}: ${errorDescription || ""}`
      )}`
    );
  }

  if (!code) {
    return NextResponse.redirect(
      `${getBaseUrl(req)}/dashboard?meta_error=${encodeURIComponent(
        "Missing code"
      )}`
    );
  }

  const appId = process.env.META_APP_ID!;
  const appSecret = process.env.META_APP_SECRET!;
  const redirectUri = `${getBaseUrl(req)}/api/meta/callback`;

  // 1) trocar "code" por access_token
  const tokenRes = await fetch(
    "https://graph.facebook.com/v20.0/oauth/access_token" +
      `?client_id=${encodeURIComponent(appId)}` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&client_secret=${encodeURIComponent(appSecret)}` +
      `&code=${encodeURIComponent(code)}`,
    { method: "GET" }
  );

  const tokenJson: any = await tokenRes.json();

  if (!tokenRes.ok) {
    return NextResponse.redirect(
      `${getBaseUrl(req)}/dashboard?meta_error=${encodeURIComponent(
        tokenJson?.error?.message || "Token exchange failed"
      )}`
    );
  }

  const access_token = tokenJson.access_token as string;
  const expires_in = Number(tokenJson.expires_in || 0);

  // 2) pegar meta user id
  const meRes = await fetch(
    `https://graph.facebook.com/v20.0/me?fields=id&access_token=${encodeURIComponent(
      access_token
    )}`
  );
  const meJson: any = await meRes.json();

  if (!meRes.ok) {
    return NextResponse.redirect(
      `${getBaseUrl(req)}/dashboard?meta_error=${encodeURIComponent(
        meJson?.error?.message || "Failed to fetch /me"
      )}`
    );
  }

  const meta_user_id = String(meJson.id);

  // 3) descobrir usuário logado no Supabase (via cookie do Next?)
  // Aqui: vamos usar SERVICE_ROLE e vincular ao tenant do usuário por email via token do supabase auth (mais avançado)
  // Para simplificar agora, vamos salvar a conexão no tenant do "owner" que estiver logado no dashboard,
  // usando um endpoint POST com bearer. Então este callback vai apenas redirecionar com o token meta.

  const redirect = `${getBaseUrl(req)}/dashboard/meta?access_token=${encodeURIComponent(
    access_token
  )}&meta_user_id=${encodeURIComponent(meta_user_id)}&expires_in=${encodeURIComponent(
    String(expires_in)
  )}`;

  return NextResponse.redirect(redirect);
}
