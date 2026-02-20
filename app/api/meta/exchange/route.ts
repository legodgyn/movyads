import { NextResponse } from "next/server";

export async function POST(req: Request) {
  try {
    const { access_token } = await req.json();

    const appId = process.env.META_APP_ID!;
    const appSecret = process.env.META_APP_SECRET!;

    if (!access_token) {
      return NextResponse.json({ error: "Missing access_token" }, { status: 400 });
    }

    if (!appId || !appSecret) {
      return NextResponse.json(
        { error: "Missing META_APP_ID or META_APP_SECRET" },
        { status: 500 }
      );
    }

    const url =
      `https://graph.facebook.com/v20.0/oauth/access_token` +
      `?grant_type=fb_exchange_token` +
      `&client_id=${encodeURIComponent(appId)}` +
      `&client_secret=${encodeURIComponent(appSecret)}` +
      `&fb_exchange_token=${encodeURIComponent(access_token)}`;

    const r = await fetch(url);
    const j: any = await r.json();

    if (!r.ok) {
      return NextResponse.json(
        { error: j?.error?.message || "Exchange failed", raw: j },
        { status: 400 }
      );
    }

    return NextResponse.json({
      ok: true,
      access_token: j.access_token,
      expires_in: j.expires_in, // segundos
      token_type: j.token_type,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Unknown error" }, { status: 500 });
  }
}
