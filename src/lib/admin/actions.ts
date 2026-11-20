"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "../db";
import { env } from "../env";
import { issueToken } from "../auth/tokens";
import { createSession, destroySession, getSessionUser, homeFor, requireUser } from "../auth/session";
import { verifyPassword } from "../auth/password";
import { mailTeacherInvite } from "../mail";
import { FEATURE_KEYS, KB_TOPICS, NEWS_TAGS } from "./features";
import { notify } from "../notify";
import { isOwner } from "../placement/bank";
import { isAdmin } from "./access";
import { shortCode } from "../auth/crypto";
import { isInternalEmail } from "../auth/cabinet";
import { translate } from "../i18n/dict";

type R<T = object> = ({ ok: true } & T) | { ok: false; error: string };
const DAY = 864e5;

async function admin() {
  const u = await getSessionUser();
  if (!isAdmin(u)) throw new Error("admin");
  return u!;
}
const done = (...paths: string[]) => { for (const p of ["/admin", "/admin/teachers", "/admin/finance", ...paths]) revalidatePath(p); };

// ───────── учителя ─────────

/** Добавить учителя: кабинет с пробным доступом на N дней и ссылка, чтобы задать пароль (письмом и для копирования). */
export async function createTeacher(x: { name: string; lastName: string; email: string; days: number; planId: string | null }): Promise<R<{ link: string; id: string }>> {
  await admin();
  const name = x.name.trim().slice(0, 80);
  const email = z.string().trim().toLowerCase().email().safeParse(x.email);
  if (!name) return { ok: false, error: "name" };
  if (!email.success) return { ok: false, error: "email" };
  if (await db.user.findUnique({ where: { email: email.data } })) return { ok: false, error: "exists" };
  const days = Math.min(365, Math.max(1, Math.round(x.days || 14)));
  const plan = x.planId ? await db.plan.findUnique({ where: { id: x.planId } }) : null;
  const user = await db.user.create({
    data: {
      name, lastName: x.lastName.trim().slice(0, 80) || null, email: email.data, role: "TEACHER", emailVerifiedAt: new Date(),
      teacherProfile: { create: { tariff: "TRIAL", trialUntil: new Date(Date.now() + days * DAY), planId: plan?.id ?? null, source: "admin" } },
    },
  });
  const token = await issueToken(user.id, "RESET_PASSWORD", { ttlMs: 7 * DAY });
  const link = `${env.appUrl}/reset?token=${token}`;
  await mailTeacherInvite(user.email, name, link, days, "ru").catch(() => undefined);
  done();
  return { ok: true, link, id: user.id };
}

/** Пригласить учителя ссылкой (без писем): человек по ней регистрируется сам или подключает кабинет учителя к своему входу ученика. */
export async function createTeacherInvite(x: { name: string; lastName: string; days: number; planId: string | null }): Promise<R<{ link: string; msg: string }>> {
  const me = await admin();
  const name = x.name.trim().slice(0, 80);
  if (!name) return { ok: false, error: "name" };
  const days = Math.min(365, Math.max(1, Math.round(x.days || 14)));
  const plan = x.planId ? await db.plan.findUnique({ where: { id: x.planId } }) : null;
  const code = shortCode();
  await db.teacherInvite.create({ data: { code, name, lastName: x.lastName.trim().slice(0, 80) || null, days, planId: plan?.id ?? null, createdBy: me.id, expiresAt: new Date(Date.now() + 30 * DAY) } });
  const link = `${env.appUrl}/ti/${code}`;
  const msg = translate("ru", "tinv.msg", { name, link });
  done();
  return { ok: true, link, msg };
}

/** Отозвать неиспользованное приглашение учителя. */
export async function revokeTeacherInvite(id: string): Promise<R> {
  await admin();
  await db.teacherInvite.deleteMany({ where: { id, usedAt: null } });
  done();
  return { ok: true };
}

/** Новая ссылка, чтобы задать пароль (если учитель потерял письмо). */
export async function teacherLink(id: string): Promise<R<{ link: string }>> {
  await admin();
  const u = await db.user.findUnique({ where: { id } });
  if (!u || u.role !== "TEACHER") return { ok: false, error: "nf" };
  return { ok: true, link: `${env.appUrl}/reset?token=${await issueToken(u.id, "RESET_PASSWORD", { ttlMs: 7 * DAY })}` };
}

/** Продлить пробный или оплаченный доступ: на N дней (от сегодняшнего дня или от текущего срока) либо до даты. */
export async function extendAccess(id: string, x: { kind: "trial" | "paid"; days?: number; until?: string }): Promise<R> {
  await admin();
  const p = await db.teacherProfile.findUnique({ where: { userId: id } });
  if (!p) return { ok: false, error: "nf" };
  const cur = x.kind === "trial" ? p.trialUntil : p.paidUntil;
  let until: Date;
  if (x.until) { until = new Date(`${x.until}T23:59:00`); if (isNaN(+until)) return { ok: false, error: "date" }; }
  else until = new Date(Math.max(Date.now(), cur?.getTime() ?? 0) + Math.max(1, Math.min(3650, Math.round(x.days ?? 0))) * DAY);
  await db.teacherProfile.update({ where: { userId: id }, data: x.kind === "trial" ? { trialUntil: until } : { paidUntil: until } });
  done(`/admin/teachers/${id}`);
  return { ok: true };
}

export async function setTeacherPlan(id: string, planId: string | null): Promise<R> {
  await admin();
  const plan = planId ? await db.plan.findUnique({ where: { id: planId } }) : null;
  await db.teacherProfile.update({ where: { userId: id }, data: { planId: plan?.id ?? null, ...(plan ? { tariff: plan.tier } : {}) } });
  done(`/admin/teachers/${id}`);
  return { ok: true };
}

export async function blockTeacher(id: string, blocked: boolean): Promise<R> {
  await admin();
  await db.teacherProfile.update({ where: { userId: id }, data: { blockedAt: blocked ? new Date() : null } });
  if (blocked) await db.session.deleteMany({ where: { userId: id } }); // выходит из всех устройств
  done(`/admin/teachers/${id}`);
  return { ok: true };
}

export async function setAdminNote(id: string, note: string): Promise<R> {
  await admin();
  await db.teacherProfile.update({ where: { userId: id }, data: { adminNote: note.trim().slice(0, 4000) || null } });
  done(`/admin/teachers/${id}`);
  return { ok: true };
}

// ───────── тарифы ─────────

export type PlanInput = { id: string | null; name: string; nameEn: string; tier: "START" | "PRO"; priceMonth: number; priceYear: number | null; maxStudents: number | null; aiPerMonth: number | null; features: string[]; blurb: string; active: boolean };

export async function savePlan(x: PlanInput): Promise<R> {
  await admin();
  const name = x.name.trim().slice(0, 60);
  if (!name) return { ok: false, error: "name" };
  const int = (n: number | null) => (n === null || !Number.isFinite(n) ? null : Math.max(0, Math.round(n)));
  const data = {
    name, nameEn: x.nameEn.trim().slice(0, 60) || null, tier: x.tier === "PRO" ? ("PRO" as const) : ("START" as const),
    priceMonth: int(x.priceMonth) ?? 0, priceYear: int(x.priceYear), maxStudents: int(x.maxStudents), aiPerMonth: int(x.aiPerMonth),
    features: x.features.filter((f) => FEATURE_KEYS.includes(f)), blurb: x.blurb.trim().slice(0, 300) || null, active: x.active,
  };
  if (x.id) await db.plan.update({ where: { id: x.id }, data });
  else await db.plan.create({ data: { ...data, order: (await db.plan.count()) + 1 } });
  done("/admin/plans");
  return { ok: true };
}

// ───────── финансы ─────────

/** Оплата от учителя: записываем и продлеваем оплаченный доступ на months месяцев (от текущего срока, если он ещё идёт). */
export async function addPayment(x: { teacherId: string; amount: number; months: number; planId: string | null; paidAt: string; note: string }): Promise<R> {
  await admin();
  const p = await db.teacherProfile.findUnique({ where: { userId: x.teacherId } });
  if (!p) return { ok: false, error: "nf" };
  const amount = Math.round(x.amount);
  if (!(amount > 0)) return { ok: false, error: "amount" };
  const months = Math.max(1, Math.min(36, Math.round(x.months || 1)));
  const plan = x.planId ? await db.plan.findUnique({ where: { id: x.planId } }) : null;
  const paidAt = x.paidAt ? new Date(`${x.paidAt}T12:00:00`) : new Date();
  if (isNaN(+paidAt)) return { ok: false, error: "date" };
  const from = new Date(Math.max(Date.now(), p.paidUntil?.getTime() ?? 0));
  const until = new Date(from); until.setMonth(until.getMonth() + months);
  await db.$transaction([
    db.teacherPayment.create({ data: { teacherId: x.teacherId, planId: plan?.id ?? p.planId, amount, months, paidAt, note: x.note.trim().slice(0, 300) || null } }),
    db.teacherProfile.update({ where: { userId: x.teacherId }, data: { paidUntil: until, ...(plan ? { planId: plan.id, tariff: plan.tier } : {}) } }),
  ]);
  done(`/admin/teachers/${x.teacherId}`);
  return { ok: true };
}

export async function deletePayment(id: string): Promise<R> {
  await admin();
  const pay = await db.teacherPayment.delete({ where: { id } }).catch(() => null);
  if (pay) done(`/admin/teachers/${pay.teacherId}`);
  return { ok: true };
}

// ───────── база знаний ─────────

export type ArticleInput = { id: string | null; title: string; body: string; kind: string; audience: string; published: boolean; pinned: boolean; topic: string | null; tag: string | null };

export async function saveArticle(x: ArticleInput): Promise<R> {
  await admin();
  const title = x.title.trim().slice(0, 160);
  if (!title) return { ok: false, error: "title" };
  const data = {
    title, body: x.body.slice(0, 20000), kind: ["guide", "digest", "news"].includes(x.kind) ? x.kind : "guide",
    audience: ["teacher", "student", "all"].includes(x.audience) ? x.audience : "teacher", published: x.published, pinned: x.pinned,
    topic: x.topic && KB_TOPICS.some((k) => k.key === x.topic) ? x.topic : null, tag: x.tag && NEWS_TAGS.some((k) => k.key === x.tag) ? x.tag : null,
  };
  if (x.id) await db.article.update({ where: { id: x.id }, data });
  else await db.article.create({ data });
  done("/admin/kb", "/teacher/platform", "/student/help");
  return { ok: true };
}

export async function deleteArticle(id: string): Promise<R> {
  await admin();
  await db.article.delete({ where: { id } }).catch(() => null);
  done("/admin/kb", "/teacher/platform", "/student/help");
  return { ok: true };
}

// ───────── второй кабинет (учитель ↔ ученик) ─────────

/** Привязать второй кабинет того же человека: нужен пароль от него — так мы знаем, что это вы. */
export async function linkCabinet(email: string, password: string): Promise<R> {
  const me = await requireUser();
  const e = email.trim().toLowerCase();
  const other = await db.user.findUnique({ where: { email: e } });
  if (!other || other.id === me.id || !other.passwordHash || !(await verifyPassword(password, other.passwordHash))) return { ok: false, error: "auth" };
  if (other.role === me.role) return { ok: false, error: "role" };
  await db.$transaction([
    db.user.updateMany({ where: { linkedUserId: { in: [me.id, other.id] } }, data: { linkedUserId: null } }),
    db.user.update({ where: { id: me.id }, data: { linkedUserId: other.id } }),
    db.user.update({ where: { id: other.id }, data: { linkedUserId: me.id } }),
  ]);
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function unlinkCabinet(): Promise<R> {
  const me = await requireUser();
  const other = me.linkedUserId ? await db.user.findUnique({ where: { id: me.linkedUserId }, select: { email: true } }) : null;
  if (isInternalEmail(me.email) || isInternalEmail(other?.email)) return { ok: false, error: "shared" }; // кабинет без своего входа потерялся бы

  await db.user.updateMany({ where: { OR: [{ id: me.id }, { linkedUserId: me.id }] }, data: { linkedUserId: null } });
  revalidatePath("/", "layout");
  return { ok: true };
}

/** Перейти во второй кабинет без повторного входа: привязка взаимная — значит, оба кабинета ваши. */
export async function switchCabinet(): Promise<R<{ href: string }>> {
  const me = await requireUser();
  const other = me.linkedUserId ? await db.user.findUnique({ where: { id: me.linkedUserId } }) : null;
  if (!other || other.linkedUserId !== me.id) return { ok: false, error: "nf" };
  await destroySession();
  await createSession(other.id, true);
  return { ok: true, href: homeFor(other.role) };
}

/** «Статья помогла?» — да / нет (повтор с того же устройства не даёт интерфейс). */
export async function voteArticle(id: string, yes: boolean): Promise<R> {
  await requireUser();
  await db.article.update({ where: { id }, data: yes ? { helpfulYes: { increment: 1 } } : { helpfulNo: { increment: 1 } } }).catch(() => null);
  return { ok: true };
}

// ───────── поддержка ─────────

/** Администраторы платформы — им приходят вопросы в поддержку. */
async function adminIds() {
  const owners = (process.env.OWNER_EMAIL ?? "").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
  const list = await db.user.findMany({ where: { OR: [{ isAdmin: true }, ...(owners.length ? [{ email: { in: owners } }] : [])] }, select: { id: true, email: true, isAdmin: true } });
  return list.filter((u) => u.isAdmin || isOwner(u.email)).map((u) => u.id);
}

/** Вопрос в поддержку от учителя (или ученика): в переписку и уведомление администраторам. */
export async function sendSupport(text: string): Promise<R> {
  const me = await requireUser();
  const body = text.trim().slice(0, 4000);
  if (!body) return { ok: false, error: "empty" };
  await db.supportMessage.create({ data: { userId: me.id, text: body } });
  const who = [me.name, me.lastName].filter(Boolean).join(" ");
  for (const id of await adminIds()) if (id !== me.id) await notify({ userId: id, kind: "message", title: `Поддержка — ${who}: ${body.slice(0, 120)}`, link: `/admin/support/${me.id}` });
  revalidatePath("/teacher/support"); revalidatePath("/admin/support");
  return { ok: true };
}

/** Ответ администратора: в переписку и уведомление учителю (в кабинет и Telegram по его настройкам). */
export async function replySupport(userId: string, text: string): Promise<R> {
  const me = await admin();
  const body = text.trim().slice(0, 4000);
  if (!body) return { ok: false, error: "empty" };
  const u = await db.user.findUnique({ where: { id: userId }, select: { role: true } });
  if (!u) return { ok: false, error: "nf" };
  await db.$transaction([
    db.supportMessage.create({ data: { userId, fromAdmin: true, authorId: me.id, text: body } }),
    db.supportMessage.updateMany({ where: { userId, fromAdmin: false, readAt: null }, data: { readAt: new Date() } }),
  ]);
  await notify({ userId, kind: "reply", title: `Поддержка VibeOn: ${body.slice(0, 160)}`, link: u.role === "TEACHER" ? "/teacher/support" : "/student" });
  revalidatePath(`/admin/support/${userId}`); revalidatePath("/admin/support");
  return { ok: true };
}
