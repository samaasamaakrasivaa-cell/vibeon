import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { useToken } from "@/lib/auth/tokens";
import { createSession, homeFor } from "@/lib/auth/session";

/** Вход по ссылке из письма (без пароля). */
export async function GET(req: NextRequest) {
  const tok = await useToken(req.nextUrl.searchParams.get("token") ?? "", "MAGIC_LINK");
  if (!tok) return NextResponse.redirect(`${env.appUrl}/login?error=link`);
  const user = await db.user.update({ where: { id: tok.userId }, data: { emailVerifiedAt: new Date() } });
  await createSession(user.id, true, req.headers.get("user-agent"));
  return NextResponse.redirect(`${env.appUrl}${homeFor(user.role)}`);
}
