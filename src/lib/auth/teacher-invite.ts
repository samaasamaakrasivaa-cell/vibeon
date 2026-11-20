"use server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { User } from "@prisma/client";
import { db } from "../db";
import { getT } from "../i18n/server";
import { rateLimit } from "../rate-limit";
import { MIN_PASSWORD, hashPassword, verifyPassword } from "./password";
import { createSession, destroySession, getSessionUser } from "./session";
import { internalEmail, linkedOf } from "./cabinet";
import { randomToken } from "./crypto";

export type TiState = { error?: string; fields?: Record<string, string> } | undefined;

const DAY = 864e5;
const emailSchema = z.string().trim().toLowerCase().email().max(200);
const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const ua = async () => (await headers()).get("user-agent");

/** Действующее приглашение учителя или null. */
async function validInvite(code: string) {
  const inv = await db.teacherInvite.findUnique({ where: { code: code.toLowerCase() } });
  return inv && !inv.usedAt && inv.expiresAt > new Date() ? inv : null;
}
type Inv = NonNullable<Awaited<ReturnType<typeof validInvite>>>;

const profileOf = (inv: Inv) => ({
  tariff: "TRIAL" as const, trialUntil: new Date(Date.now() + Math.max(1, inv.days) * DAY), planId: inv.planId ?? null, source: "invite",
});

/** Пометить приглашение использованным (одна ссылка — один кабинет); если кто-то успел раньше — false. */
async function claim(inv: Inv, userId: string) {
  const r = await db.teacherInvite.updateMany({ where: { id: inv.id, usedAt: null }, data: { usedAt: new Date(), usedBy: userId } });
  return r.count === 1;
}

/** Ученик получает кабинет учителя на тот же вход: служебный адрес без пароля, взаимная привязка. */
async function attachTeacher(student: User, inv: Inv) {
  const teacher = await db.$transaction(async (tx) => {
    const u = await tx.user.create({
      data: {
        email: internalEmail(randomToken(9).toLowerCase().replace(/[^a-z0-9]/g, "")), passwordHash: null, emailVerifiedAt: new Date(),
        name: student.name, lastName: student.lastName, phone: student.phone, lang: student.lang, timezone: student.timezone,
        consentAt: student.consentAt ?? new Date(), role: "TEACHER", linkedUserId: student.id,
        teacherProfile: { create: profileOf(inv) },
      },
    });
    // прежняя привязка ученика (если была) снимается: у человека один кабинет учителя
    await tx.user.updateMany({ where: { linkedUserId: student.id, id: { not: u.id } }, data: { linkedUserId: null } });
    await tx.user.update({ where: { id: student.id }, data: { linkedUserId: u.id } });
    return u;
  });
  if (!(await claim(inv, teacher.id))) { await db.user.delete({ where: { id: teacher.id } }).catch(() => null); return null; }
  return teacher;
}

/** Уже вошли как ученик — подключить кабинет учителя к этому входу. */
export async function joinAsSignedIn(code: string): Promise<TiState> {
  const { t } = await getT();
  const inv = await validInvite(code);
  if (!inv) return { error: t("tinv.bad.text") };
  const me = await getSessionUser();
  if (!me) return { error: t("tinv.err.signin") };
  if (me.role === "TEACHER") redirect("/teacher");
  if (await linkedOf(me).then((x) => x?.role === "TEACHER")) return { error: t("tinv.err.hasTeacher") };
  const teacher = await attachTeacher(me, inv);
  if (!teacher) return { error: t("tinv.bad.text") };
  await destroySession();
  await createSession(teacher.id, true, await ua());
  revalidatePath("/", "layout");
  redirect("/teacher");
}

/** Есть вход ученика (почта и пароль) — проверяем его и подключаем кабинет учителя к нему. */
export async function joinWithLogin(code: string, _: TiState, f: FormData): Promise<TiState> {
  const { t } = await getT();
  const fields = { email: str(f, "email") };
  if (!(await rateLimit("ti-login", 10))) return { error: t("auth.err.rate"), fields };
  const inv = await validInvite(code);
  if (!inv) return { error: t("tinv.bad.text"), fields };
  const email = emailSchema.safeParse(fields.email);
  if (!email.success) return { error: t("auth.err.email"), fields };
  const user = await db.user.findUnique({ where: { email: email.data } });
  if (!user?.passwordHash || !(await verifyPassword(str(f, "password"), user.passwordHash))) return { error: t("auth.err.wrong"), fields };
  const linked = await linkedOf(user);
  if (user.role === "TEACHER" || linked?.role === "TEACHER") {
    // кабинет учителя уже есть — просто входим в него
    await createSession((user.role === "TEACHER" ? user : linked!).id, true, await ua());
    redirect("/teacher");
  }
  const teacher = await attachTeacher(user, inv);
  if (!teacher) return { error: t("tinv.bad.text"), fields };
  await createSession(teacher.id, true, await ua());
  redirect("/teacher");
}

/** Новый человек: регистрация учителя по приглашению. Почта — только логин, писем не отправляем. */
export async function joinNew(code: string, _: TiState, f: FormData): Promise<TiState> {
  const { t, lang } = await getT();
  const fields = { name: str(f, "name"), lastName: str(f, "lastName"), email: str(f, "email"), consent: f.get("consent") === "on" ? "on" : "" };
  if (!(await rateLimit("ti-new", 5))) return { error: t("auth.err.rate"), fields };
  const inv = await validInvite(code);
  if (!inv) return { error: t("tinv.bad.text"), fields };
  const name = fields.name.slice(0, 80);
  if (!name) return { error: t("auth.err.name"), fields };
  const email = emailSchema.safeParse(fields.email);
  if (!email.success) return { error: t("auth.err.email"), fields };
  const password = str(f, "password");
  if (password.length < MIN_PASSWORD) return { error: t("auth.err.password"), fields };
  if (f.has("password2") && str(f, "password2") !== password) return { error: t("auth.err.mismatch"), fields };
  if (f.get("consent") !== "on") return { error: t("auth.err.consent"), fields };
  if (await db.user.findUnique({ where: { email: email.data } })) return { error: t("tinv.err.taken"), fields };
  const user = await db.user.create({
    data: {
      name, lastName: fields.lastName.slice(0, 80) || null, email: email.data, passwordHash: await hashPassword(password),
      consentAt: new Date(), lang: lang === "en" ? "EN" : "RU", role: "TEACHER", teacherProfile: { create: profileOf(inv) },
    },
  });
  if (!(await claim(inv, user.id))) { await db.user.delete({ where: { id: user.id } }).catch(() => null); return { error: t("tinv.bad.text"), fields }; }
  await createSession(user.id, true, await ua());
  redirect("/teacher");
}

/** На устройстве вошёл другой человек — выходим и остаёмся на странице приглашения. */
export async function notMe(code: string) {
  await destroySession();
  redirect(`/ti/${encodeURIComponent(code)}`);
}
