import { NextResponse, type NextRequest } from "next/server";
import { oauthEnabled, env, secureCookies } from "@/lib/env";
import { buildAuthorizeUrl, PROVIDERS, type Provider } from "@/lib/auth/oauth";

/** Начало входа через Яндекс/VK. ?intent=login|signup (signup — только с согласием на ПД). */
export async function GET(req: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  const p = (await params).provider as Provider;
  if (!PROVIDERS.includes(p) || !oauthEnabled[p]) return NextResponse.redirect(`${env.appUrl}/login`);
  const intent = req.nextUrl.searchParams.get("intent") === "signup" && req.nextUrl.searchParams.get("consent") === "1" ? "signup" : "login";
  const { url, state, verifier } = buildAuthorizeUrl(p);
  const res = NextResponse.redirect(url);
  res.cookies.set("vo_oauth", JSON.stringify({ p, state, verifier, intent }), {
    httpOnly: true, secure: secureCookies, sameSite: "lax", path: "/", maxAge: 600,
  });
  return res;
}
