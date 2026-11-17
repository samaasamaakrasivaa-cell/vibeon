"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "../db";
import { env } from "../env";
import { issueToken } from "../auth/tokens";
import { createSession, destroySession, getSessionUser, homeFor, requireUser } from "../auth/session";
import { verifyPassword } from "../auth/password";
import { mailTeacherInvite } from "../mail";
import { FEATURE_KEYS } from "./features";
import { isAdmin } from "./access";

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

export type ArticleInput = { id: string | null; title: string; body: string; kind: string; audience: string; published: boolean; pinned: boolean };

export async function saveArticle(x: ArticleInput): Promise<R> {
  await admin();
  const title = x.title.trim().slice(0, 160);
  if (!title) return { ok: false, error: "title" };
  const data = {
    title, body: x.body.slice(0, 20000), kind: ["guide", "digest", "news"].includes(x.kind) ? x.kind : "guide",
    audience: ["teacher", "student", "all"].includes(x.audience) ? x.audience : "teacher", published: x.published, pinned: x.pinned,
  };
  if (x.id) await db.article.update({ where: { id: x.id }, data });
  else await db.article.create({ data });
  done("/admin/kb", "/teacher/help", "/student/help");
  return { ok: true };
}

export async function deleteArticle(id: string): Promise<R> {
  await admin();
  await db.article.delete({ where: { id } }).catch(() => null);
  done("/admin/kb", "/teacher/help", "/student/help");
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
