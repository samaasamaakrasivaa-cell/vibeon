import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { Role } from "@prisma/client";
import { db } from "../db";
import { randomToken, sha256 } from "./crypto";
import { secureCookies } from "../env";

export const SESSION_COOKIE = "vo_session";
const LONG = 30 * 24 * 3600 * 1000; // «Запомнить меня» — 30 дней
const SHORT = 12 * 3600 * 1000; // без галочки — до закрытия браузера (максимум 12 ч)

export async function createSession(userId: string, remember = true, userAgent?: string | null) {
  const token = randomToken();
  const expiresAt = new Date(Date.now() + (remember ? LONG : SHORT));
  await db.session.create({ data: { userId, tokenHash: sha256(token), expiresAt, userAgent: userAgent?.slice(0, 300) } });
  const user = await db.user.findUnique({ where: { id: userId }, select: { lang: true } });
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: secureCookies,
    sameSite: "lax",
    path: "/",
    ...(remember ? { expires: expiresAt } : {}),
  });
  // Язык из профиля
  if (user) jar.set("lang", user.lang === "EN" ? "en" : "ru", { path: "/", maxAge: 365 * 24 * 3600, sameSite: "lax" });
}

/** Текущий пользователь по куке сессии (кэшируется на время одного запроса). */
export const getSessionUser = cache(async () => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const s = await db.session.findUnique({ where: { tokenHash: sha256(token) }, include: { user: true } });
  if (!s || s.expiresAt < new Date()) return null;
  return s.user;
});

export function homeFor(role: Role) {
  return role === "TEACHER" ? "/teacher" : "/student";
}

/** Пускает только пользователя нужной роли; остальных — на вход или в свой кабинет. */
export async function requireUser(role?: Role) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (role && user.role !== role) redirect(homeFor(user.role));
  return user;
}

export async function destroySession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await db.session.deleteMany({ where: { tokenHash: sha256(token) } });
  jar.delete(SESSION_COOKIE);
}

/** Если пользователь уже вошёл — сразу в его кабинет (для страниц входа). */
export async function redirectIfSignedIn() {
  const u = await getSessionUser();
  if (u) redirect(homeFor(u.role));
}
