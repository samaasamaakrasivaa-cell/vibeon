import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { fetchProfile, PROVIDERS, providerLabel, type Provider } from "@/lib/auth/oauth";
import { createSession, homeFor } from "@/lib/auth/session";

const fail = (code: string, p: Provider) => NextResponse.redirect(`${env.appUrl}/login?error=${code}&p=${p}`);

export async function GET(req: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  const p = (await params).provider as Provider;
  if (!PROVIDERS.includes(p)) return NextResponse.redirect(`${env.appUrl}/login`);
  let saved: { p: string; state: string; verifier: string; intent: string };
  try {
    saved = JSON.parse(req.cookies.get("vo_oauth")?.value ?? "");
  } catch {
    return fail("oauth", p);
  }
  const q = req.nextUrl.searchParams;
  if (saved.p !== p || !q.get("code") || q.get("state") !== saved.state) return fail("oauth", p);

  let profile;
  try {
    profile = await fetchProfile(p, q, saved.verifier);
  } catch (e) {
    console.error("[oauth]", providerLabel[p], e);
    return fail("oauth", p);
  }

  let user = (await db.oAuthAccount.findUnique({ where: { provider_providerAccountId: { provider: p, providerAccountId: profile.id } }, include: { user: true } }))?.user ?? null;
  if (!user) {
    if (!profile.email) return fail("oauthEmail", p);
    const email = profile.email.toLowerCase();
    user = await db.user.findUnique({ where: { email } });
    if (!user && saved.intent === "signup") {
      user = await db.user.create({
        data: {
          email, name: profile.firstName || email.split("@")[0], lastName: profile.lastName || null,
          role: "TEACHER", emailVerifiedAt: new Date(), consentAt: new Date(),
          teacherProfile: { create: { tariff: "TRIAL", trialUntil: new Date(Date.now() + env.trialDays * 864e5) } },
        },
      });
    }
    if (!user) return fail("noaccount", p);
    await db.oAuthAccount.create({ data: { userId: user.id, provider: p, providerAccountId: profile.id } });
    if (!user.emailVerifiedAt) await db.user.update({ where: { id: user.id }, data: { emailVerifiedAt: new Date() } });
  }
  await createSession(user.id, true, req.headers.get("user-agent"));
  const res = NextResponse.redirect(`${env.appUrl}${homeFor(user.role)}`);
  res.cookies.delete("vo_oauth");
  return res;
}
