"use server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "../db";
import { env } from "../env";
import { getT } from "../i18n/server";
import { mailInvite, mailMagic, mailReset, mailVerify } from "../mail";
import { rateLimit } from "../rate-limit";
import { randomToken } from "./crypto";
import { MIN_PASSWORD, hashPassword, verifyPassword } from "./password";
import { createSession, destroySession, homeFor, requireUser } from "./session";
import { issueToken, useToken } from "./tokens";

export type FormState = { error?: string; fields?: Record<string, string>; ok?: string; link?: string } | undefined;

const emailSchema = z.string().trim().toLowerCase().email().max(200);
const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const ua = async () => (await headers()).get("user-agent");
const checkEmailUrl = (email: string, kind: "verify" | "magic" | "reset") => `/check-email?k=${kind}&e=${encodeURIComponent(email)}`;

// ───────── Вход по паролю ─────────
export async function loginAction(_: FormState, f: FormData): Promise<FormState> {
  const { t, lang } = await getT();
  const fields = { email: str(f, "email") };
  if (!(await rateLimit("login", 10))) return { error: t("auth.err.rate"), fields };
  const email = emailSchema.safeParse(fields.email);
  if (!email.success) return { error: t("auth.err.email"), fields };
  const user = await db.user.findUnique({ where: { email: email.data } });
  if (!user) return { error: t("auth.err.wrong"), fields };
  if (!user.passwordHash) return { error: t("auth.err.noPassword"), fields };
  if (!(await verifyPassword(str(f, "password"), user.passwordHash))) return { error: t("auth.err.wrong"), fields };
  if (!user.emailVerifiedAt) {
    await mailVerify(user.email, user.name, `${env.appUrl}/auth/verify?token=${await issueToken(user.id, "VERIFY_EMAIL")}`, lang);
    redirect(checkEmailUrl(user.email, "verify"));
  }
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
  if (f.get("consent") !== "on") return { error: t("auth.err.consent"), fields };

  const existing = await db.user.findUnique({ where: { email: email.data } });
  if (existing?.emailVerifiedAt || (existing && existing.role !== "TEACHER")) return { error: t("auth.err.exists"), fields };

  const data = { name, passwordHash: await hashPassword(password), consentAt: new Date(), lang: lang === "en" ? ("EN" as const) : ("RU" as const) };
  const user = existing
    ? await db.user.update({ where: { id: existing.id }, data })
    : await db.user.create({
        data: {
          ...data,
          email: email.data,
          role: "TEACHER",
          teacherProfile: { create: { tariff: "TRIAL", trialUntil: new Date(Date.now() + env.trialDays * 864e5) } },
        },
      });
  await mailVerify(user.email, user.name, `${env.appUrl}/auth/verify?token=${await issueToken(user.id, "VERIFY_EMAIL")}`, lang);
  redirect(checkEmailUrl(user.email, "verify"));
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
  const { t, lang } = await getT();
  const teacher = await requireUser("TEACHER");
  const fields = { name: str(f, "name"), contact: str(f, "contact") };
  const name = fields.name.slice(0, 80);
  if (!name) return { error: t("auth.err.name"), fields };
  const asEmail = emailSchema.safeParse(fields.contact);
  const tg = /^@?[a-zA-Z0-9_]{5,32}$/.test(fields.contact) ? "@" + fields.contact.replace(/^@/, "") : null;
  if (!asEmail.success && !tg) return { error: t("inviteT.err.contact"), fields };

  const token = randomToken(24);
  const student = await db.student.create({
    data: {
      teacherId: teacher.id,
      name,
      email: asEmail.success ? asEmail.data : null,
      telegram: tg,
      invites: {
        create: {
          teacherId: teacher.id,
          token,
          channel: asEmail.success ? "EMAIL" : "TELEGRAM",
          expiresAt: new Date(Date.now() + 14 * 864e5),
        },
      },
    },
  });
  const link = `${env.appUrl}/invite/${token}`;
  if (asEmail.success) await mailInvite(asEmail.data, name, [teacher.name, teacher.lastName].filter(Boolean).join(" "), link, lang);
  return { ok: asEmail.success ? t("inviteT.sentEmail", { c: asEmail.data }) : student.name, link };
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
  if (password && password.length < MIN_PASSWORD) return { error: t("auth.err.password"), fields };
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
        passwordHash: password ? await hashPassword(password) : null,
        // Ссылка-приглашение пришла на эту почту — значит, она подтверждена.
        emailVerifiedAt: invite.student.email === email.data ? new Date() : null,
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
        link: `/teacher/students`,
      },
    });
    return u;
  });
  if (!user.emailVerifiedAt)
    await mailVerify(user.email, user.name, `${env.appUrl}/auth/verify?token=${await issueToken(user.id, "VERIFY_EMAIL")}`, lang);
  await createSession(user.id, true, await ua());
  redirect("/student/welcome");
}
