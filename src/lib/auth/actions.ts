"use server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "../db";
import { env } from "../env";
import { getT } from "../i18n/server";
import { translate } from "../i18n/dict";
import { mailMagic, mailReset, mailVerify } from "../mail";
import { rateLimit } from "../rate-limit";
import { shortCode } from "./crypto";
import { accessUrl, inviteMessage, inviteUrl } from "../invite";
import { MIN_PASSWORD, hashPassword, verifyPassword } from "./password";
import { createSession, destroySession, homeFor, requireUser } from "./session";
import { issueToken, useToken } from "./tokens";

export type FormState = { error?: string; fields?: Record<string, string>; ok?: string; link?: string; msg?: string; id?: string; warn?: boolean } | undefined;

const emailSchema = z.string().trim().toLowerCase().email().max(200);
const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const ua = async () => (await headers()).get("user-agent");
const checkEmailUrl = (email: string, kind: "verify" | "magic" | "reset") => `/check-email?k=${kind}&e=${encodeURIComponent(email)}`;

// ───────── Вход по паролю ─────────
export async function loginAction(_: FormState, f: FormData): Promise<FormState> {
  const { t } = await getT();
  const fields = { email: str(f, "email") };
  if (!(await rateLimit("login", 10))) return { error: t("auth.err.rate"), fields };
  const email = emailSchema.safeParse(fields.email);
  if (!email.success) return { error: t("auth.err.email"), fields };
  const user = await db.user.findUnique({ where: { email: email.data } });
  if (!user) return { error: t("auth.err.wrong"), fields };
  if (!user.passwordHash) return { error: t("auth.err.noPassword"), fields };
  if (!(await verifyPassword(str(f, "password"), user.passwordHash))) return { error: t("auth.err.wrong"), fields };
  // Подтверждение почты не обязательно для входа: письма доходят не до всех почтовых сервисов,
  // а заблокированный вход — худший первый опыт. Письмо-подтверждение уходит при регистрации.
  await createSession(user.id, f.get("remember") === "on", await ua());
  redirect(safeNext(str(f, "next")) ?? homeFor(user.role));
}

/** Разрешаем возврат только на свои страницы (защита от перенаправления на чужие сайты). */
function safeNext(next: string) {
  return next.startsWith("/") && !next.startsWith("//") ? next : null;
}

// ───────── Вход по ссылке на почту ─────────
export async function magicAction(_: FormState, f: FormData): Promise<FormState> {
  const { t, lang } = await getT();
  const fields = { email: str(f, "email") };
  if (!(await rateLimit("magic", 5))) return { error: t("auth.err.rate"), fields };
  const email = emailSchema.safeParse(fields.email);
  if (!email.success) return { error: t("auth.err.email"), fields };
  const user = await db.user.findUnique({ where: { email: email.data } });
  // Не сообщаем, есть ли такой аккаунт: экран один и тот же.
  if (user) await mailMagic(user.email, `${env.appUrl}/auth/magic?token=${await issueToken(user.id, "MAGIC_LINK")}`, lang);
  redirect(checkEmailUrl(email.data, "magic"));
}

// ───────── Регистрация учителя ─────────
export async function signupAction(_: FormState, f: FormData): Promise<FormState> {
  const { t, lang } = await getT();
  const fields = { name: str(f, "name"), email: str(f, "email") };
  if (!(await rateLimit("signup", 5))) return { error: t("auth.err.rate"), fields };
  const name = fields.name.slice(0, 80);
  if (!name) return { error: t("auth.err.name"), fields };
  const email = emailSchema.safeParse(fields.email);
  if (!email.success) return { error: t("auth.err.email"), fields };
  const password = str(f, "password");
  if (password.length < MIN_PASSWORD) return { error: t("auth.err.password"), fields };
  if (f.has("password2") && str(f, "password2") !== password) return { error: t("auth.err.mismatch"), fields };
  if (f.get("consent") !== "on") return { error: t("auth.err.consent"), fields };

  // Вход теперь не ждёт подтверждения почты — значит, занятую почту нельзя «перезаписать» повторной регистрацией.
  if (await db.user.findUnique({ where: { email: email.data } })) return { error: t("auth.err.exists"), fields };

  const user = await db.user.create({
    data: {
      name, passwordHash: await hashPassword(password), consentAt: new Date(), lang: lang === "en" ? "EN" : "RU",
      email: email.data,
      role: "TEACHER",
      teacherProfile: { create: { tariff: "TRIAL", trialUntil: new Date(Date.now() + env.trialDays * 864e5) } },
    },
  });
  // письмо-подтверждение — по желанию: не дошло — ничего не блокирует
  await mailVerify(user.email, user.name, `${env.appUrl}/auth/verify?token=${await issueToken(user.id, "VERIFY_EMAIL")}`, lang);
  await createSession(user.id, true, await ua());
  redirect(homeFor(user.role));
}

// ───────── «Отправить ещё раз» ─────────
export async function resendAction(email: string, kind: "verify" | "magic" | "reset"): Promise<{ ok: boolean }> {
  const { lang } = await getT();
  if (!(await rateLimit(`resend:${email}`, 1, 40))) return { ok: false };
  const parsed = emailSchema.safeParse(email);
  if (!parsed.success) return { ok: false };
  const user = await db.user.findUnique({ where: { email: parsed.data } });
  if (!user) return { ok: true };
  if (kind === "verify" && !user.emailVerifiedAt)
    await mailVerify(user.email, user.name, `${env.appUrl}/auth/verify?token=${await issueToken(user.id, "VERIFY_EMAIL")}`, lang);
  if (kind === "magic") await mailMagic(user.email, `${env.appUrl}/auth/magic?token=${await issueToken(user.id, "MAGIC_LINK")}`, lang);
  if (kind === "reset") await mailReset(user.email, `${env.appUrl}/reset?token=${await issueToken(user.id, "RESET_PASSWORD")}`, lang);
  return { ok: true };
}

// ───────── Забыли пароль ─────────
export async function forgotAction(_: FormState, f: FormData): Promise<FormState> {
  const { t, lang } = await getT();
  const fields = { email: str(f, "email") };
  if (!(await rateLimit("forgot", 5))) return { error: t("auth.err.rate"), fields };
  const email = emailSchema.safeParse(fields.email);
  if (!email.success) return { error: t("auth.err.email"), fields };
  const user = await db.user.findUnique({ where: { email: email.data } });
  if (user) await mailReset(user.email, `${env.appUrl}/reset?token=${await issueToken(user.id, "RESET_PASSWORD")}`, lang);
  redirect(checkEmailUrl(email.data, "reset"));
}

export async function resetAction(_: FormState, f: FormData): Promise<FormState> {
  const { t } = await getT();
  const password = str(f, "password");
  if (password.length < MIN_PASSWORD) return { error: t("auth.err.password") };
  if (f.has("password2") && str(f, "password2") !== password) return { error: t("auth.err.mismatch") };
  const tok = await useToken(str(f, "token"), "RESET_PASSWORD");
  if (!tok) return { error: t("auth.reset.bad") };
  const user = await db.user.update({
    where: { id: tok.userId },
    data: { passwordHash: await hashPassword(password), emailVerifiedAt: new Date() },
  });
  await db.session.deleteMany({ where: { userId: user.id } }); // выходим на всех устройствах
  await createSession(user.id, true, await ua());
  redirect(homeFor(user.role));
}

export async function logoutAction() {
  await destroySession();
  redirect("/login");
}

// ───────── Учитель приглашает ученика ─────────
export async function inviteStudentAction(_: FormState, f: FormData): Promise<FormState> {
  const { t } = await getT();
  const teacher = await requireUser("TEACHER");
  const fields = { name: str(f, "name") };
  const name = fields.name.slice(0, 80);
  if (!name) return { error: t("auth.err.name"), fields };
  const student = await db.student.create({ data: { teacherId: teacher.id, name, startedAt: new Date() } });
  const link = await newInvite(teacher.id, student.id);
  const { lang } = await getT();
  return { ok: student.name, link, msg: inviteMessage(lang, student.name, [teacher.name, teacher.lastName].filter(Boolean).join(" "), link), id: student.id };
}

/** Новая короткая ссылка-приглашение (старые неиспользованные — гасим). Письмо не отправляется: ссылку учитель пересылает сам. */
async function newInvite(teacherId: string, studentId: string) {
  await db.invite.deleteMany({ where: { studentId, usedAt: null } });
  for (let i = 0; ; i++) {
    const token = shortCode(10);
    try {
      await db.invite.create({ data: { teacherId, studentId, token, channel: "LINK", expiresAt: new Date(Date.now() + 30 * 864e5) } });
      return inviteUrl(token);
    } catch (e) {
      if (i >= 3) throw e; // совпадение кода — почти невозможно, но пробуем другой
    }
  }
}

/** «Новая ссылка» для ученика, который ещё не заполнил анкету (старая истекла или потерялась). */
export async function renewInviteAction(studentId: string): Promise<{ ok: boolean; link?: string; msg?: string }> {
  const { lang } = await getT();
  const teacher = await requireUser("TEACHER");
  const s = await db.student.findFirst({ where: { id: studentId, teacherId: teacher.id, userId: null } });
  if (!s) return { ok: false };
  const link = await newInvite(teacher.id, s.id);
  return { ok: true, link, msg: inviteMessage(lang, s.name, [teacher.name, teacher.lastName].filter(Boolean).join(" "), link) };
}

/** Ссылка восстановления доступа: ученик забыл пароль, а письмо до его почты не доходит — учитель пересылает ссылку сам. */
export async function accessLinkAction(studentId: string): Promise<{ ok: boolean; link?: string; msg?: string }> {
  const teacher = await requireUser("TEACHER");
  const s = await db.student.findFirst({ where: { id: studentId, teacherId: teacher.id, userId: { not: null } } });
  if (!s?.userId) return { ok: false };
  const code = shortCode(10);
  await issueToken(s.userId, "RESET_PASSWORD", { token: code, ttlMs: 48 * 3600e3 });
  const { lang } = await getT();
  const link = accessUrl(code);
  return { ok: true, link, msg: translate(lang, "inviteT.accessMsg", { name: s.name, link }) };
}

// ───────── Ученик заполняет стартовую анкету по приглашению ─────────
export async function inviteFormAction(token: string, _: FormState, f: FormData): Promise<FormState> {
  const { t, lang } = await getT();
  const invite = await db.invite.findUnique({ where: { token }, include: { student: true } });
  if (!invite || invite.usedAt || invite.expiresAt < new Date()) return { error: t("inv.bad.text") };

  const keys = ["first", "last", "email", "phone", "bday", "other", "about", "since", "problem"] as const;
  const fields = Object.fromEntries(keys.map((k) => [k, str(f, k)])) as Record<(typeof keys)[number], string>;
  const required = { first: t("ob.first"), last: t("ob.last"), email: t("auth.email"), phone: t("ob.phone") };
  for (const [k, label] of Object.entries(required))
    if (!fields[k as keyof typeof required]) return { error: `${t("ob.err.required")}: ${label}`, fields };
  const email = emailSchema.safeParse(fields.email);
  if (!email.success) return { error: t("auth.err.email"), fields };
  const password = str(f, "password");
  if (password.length < MIN_PASSWORD) return { error: t("auth.err.password"), fields };
  if (str(f, "password2") !== password) return { error: t("auth.err.mismatch"), fields };
  if (f.get("consent") !== "on") return { error: t("auth.err.consent"), fields };

  const taken = await db.user.findUnique({ where: { email: email.data } });
  if (taken) return { error: t("ob.err.taken"), fields };

  const form = {
    phone: fields.phone,
    birthday: fields.bday || null,
    goals: f.getAll("goals").map(String),
    otherGoal: fields.other,
    about: fields.about,
    since: fields.since,
    easy: f.getAll("easy").map(String),
    hard: f.getAll("hard").map(String),
    problem: fields.problem,
    filledAt: new Date().toISOString(),
  };
  const user = await db.$transaction(async (tx) => {
    const u = await tx.user.create({
      data: {
        email: email.data,
        name: fields.first.slice(0, 80),
        lastName: fields.last.slice(0, 80),
        phone: fields.phone.slice(0, 40),
        role: "STUDENT",
        lang: lang === "en" ? "EN" : "RU",
        consentAt: new Date(),
        passwordHash: await hashPassword(password),
        emailVerifiedAt: null, // подтверждение — по желанию, на вход не влияет
      },
    });
    await tx.student.update({
      where: { id: invite.studentId },
      data: { userId: u.id, status: "ACTIVE", name: u.name, lastName: u.lastName, email: u.email, form },
    });
    await tx.invite.update({ where: { id: invite.id }, data: { usedAt: new Date() } });
    await tx.notification.create({
      data: {
        userId: invite.teacherId,
        kind: "student_joined",
        title: lang === "en" ? `${u.name} ${u.lastName} filled in the starting form` : `${u.name} ${u.lastName} заполнил(а) стартовую анкету`,
        action: "open_profile",
        link: `/teacher/students/${invite.studentId}`,
      },
    });
    return u;
  });
  if (!user.emailVerifiedAt)
    await mailVerify(user.email, user.name, `${env.appUrl}/auth/verify?token=${await issueToken(user.id, "VERIFY_EMAIL")}`, lang);
  await createSession(user.id, true, await ua());
  redirect("/student/welcome");
}
