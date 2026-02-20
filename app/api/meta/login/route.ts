import { NextResponse } from "next/server";

export async function GET() {
  const appId = process.env.META_APP_ID!;
  const redirectUri = `${process.env.NEXT_PUBLIC_APP_URL}/api/meta/callback`;

  // ✅ scopes válidos para Ads API
  const scope = [
    "ads_read",
    "business_management"
    // se um dia precisar criar/editar campanhas: "ads_management"
  ].join(",");

  const url =
    "https://www.facebook.com/v20.0/dialog/oauth" +
    `?client_id=${encodeURIComponent(appId)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&scope=${encodeURIComponent(scope)}` +
    `&response_type=code`;

  return NextResponse.redirect(url);
}
