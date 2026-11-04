"use server";
import { revalidatePath } from "next/cache";
import { db } from "../db";
import { requireUser } from "../auth/session";
import { getT } from "../i18n/server";
import { acceptInvoice, createInvoice, notifyInvoice, packOptions, submitProof, undoAccept } from "./engine";
import { sendMessage } from "../student/actions";
import { notify } from "../notify";

export type R = { ok: true; auto?: boolean } | { ok: false; error: string };
const refresh = () => { revalidatePath("/teacher", "layout"); revalidatePath("/student", "layout"); };

async function teacherInvoice(id: string) {
  const me = await requireUser("TEACHER");
  const inv = await db.invoice.findUnique({ where: { id }, include: { student: true } });
  if (!inv || inv.student.teacherId !== me.id) throw new Error("not found");
  return inv;
}
async function ownStudent(id: string) {
  const me = await requireUser("TEACHER");
  const s = await db.student.findUnique({ where: { id } });
  if (!s || s.teacherId !== me.id) throw new Error("not found");
  return s;
}
async function me() {
  const u = await requireUser("STUDENT");
  const s = await db.student.findUnique({ where: { userId: u.id } });
  if (!s) throw new Error("no student");
  return { u, s };
}

// ───────── Учитель ─────────

/** «Отметить оплату» — учитель сам подтверждает оплату. */
export async function markPaid(id: string): Promise<R> {
  const inv = await teacherInvoice(id);
  if (inv.status === "PAID") return { ok: true };
  await acceptInvoice(inv, false);
  if (inv.student.userId) await notify({ userId: inv.student.userId, kind: "paid", title: `Оплата получена: ${new Intl.NumberFormat("ru-RU").format(inv.amount)} ₽. Спасибо!`, link: "/student/payments?tab=bills" });
  refresh();
  return { ok: true };
}

/** «ОК» у автоматически принятой оплаты — строка закрывается. */
export async function closeInvoice(id: string): Promise<R> {
  await teacherInvoice(id);
  await db.invoice.update({ where: { id }, data: { closedAt: new Date() } });
  refresh();
  return { ok: true };
}

/** «Отменить» — автоприём отменяется, счёт снова ждёт проверки. */
export async function undoAuto(id: string): Promise<R> {
  const inv = await teacherInvoice(id);
  await undoAccept(inv);
  refresh();
  return { ok: true };
}

/** Подтверждение не подошло — счёт снова ждёт оплаты, ученику уведомление. */
export async function rejectProof(id: string, comment: string): Promise<R> {
  const inv = await teacherInvoice(id);
  await db.invoice.update({ where: { id }, data: { status: "SENT", autoAccepted: false } });
  if (inv.student.userId) await notify({ userId: inv.student.userId, kind: "invoice", title: `Оплата не найдена${comment ? `: ${comment.slice(0, 100)}` : ""}. Проверь, пожалуйста`, action: "decide", link: "/student/payments?tab=bills" });
  refresh();
  return { ok: true };
}

export async function resendInvoice(id: string): Promise<R> {
  const inv = await teacherInvoice(id);
  await db.invoice.update({ where: { id }, data: { remindedAt: new Date(), remindCount: { increment: 1 } } });
  await notifyInvoice(inv.student, inv, true);
  refresh();
  return { ok: true };
}

export async function cancelInvoice(id: string): Promise<R> {
  const inv = await teacherInvoice(id);
  await db.invoice.update({ where: { id }, data: { status: "CANCELLED" } });
  if (inv.lessonIds.length) await db.lessonInstance.updateMany({ where: { id: { in: inv.lessonIds } }, data: { billedAt: null } });
  refresh();
  return { ok: true };
}

/** Выставить счёт сейчас: постоплата — за все проведённые и ещё не оплаченные уроки. */
export async function billNow(studentId: string): Promise<R> {
  const { t } = await getT();
  const s = await ownStudent(studentId);
  const lessons = await db.lessonInstance.findMany({ where: { studentId, billedAt: null, isTrial: false, OR: [{ status: "DONE" }, { status: "MISSED", charged: true }] }, orderBy: { startsAt: "asc" } });
  if (!lessons.length) return { ok: false, error: t("pay.err.nothingToBill") };
  const amount = lessons.reduce((a, l) => a + (l.price ?? s.price ?? 0), 0);
  await createInvoice(s, { amount, kind: "lessons", lessonIds: lessons.map((l) => l.id), title: lessons.length === 1 ? "Урок" : `Уроки: ${lessons.length}` });
  refresh();
  return { ok: true };
}

/** «Запросить оплату за новый абонемент». */
export async function requestPackPayment(studentId: string, n?: number): Promise<R> {
  const { t } = await getT();
  const s = await ownStudent(studentId);
  const opts = packOptions(s);
  const opt = opts.find((o) => o.n === n) ?? opts.find((o) => o.main) ?? opts[opts.length - 1];
  if (!opt) return { ok: false, error: t("pay.err.noPrices") };
  if (await db.invoice.count({ where: { studentId, kind: "pack", status: { in: ["SENT", "PROOF_SENT"] } } })) return { ok: false, error: t("pay.err.openPack") };
  await createInvoice(s, { amount: opt.price, kind: "pack", title: `Абонемент, ${opt.n} занятий`, packLessons: opt.n });
  refresh();
  return { ok: true };
}

export async function manualInvoice(studentId: string, amount: number, title: string): Promise<R> {
  const { t } = await getT();
  const s = await ownStudent(studentId);
  if (!(amount > 0 && amount < 10_000_000)) return { ok: false, error: t("prof.err.pack") };
  await createInvoice(s, { amount, kind: "manual", title: title.trim().slice(0, 200) || "Оплата занятий" });
  refresh();
  return { ok: true };
}

/** Чек («Мой налог») к оплате. */
export async function attachReceipt(id: string, url: string): Promise<R> {
  const inv = await teacherInvoice(id);
  if (!url.startsWith("/api/files/")) return { ok: false, error: "file" };
  await db.invoice.update({ where: { id }, data: { receiptFile: url } });
  if (inv.student.userId) await notify({ userId: inv.student.userId, kind: "receipt", title: "Преподаватель прикрепил чек к оплате", link: "/student/payments?tab=bills" });
  refresh();
  return { ok: true };
}

/** Реквизиты для оплаты — их ученик видит в счёте. */
export async function savePayDetails(text: string): Promise<R> {
  const u = await requireUser("TEACHER");
  const prof = await db.teacherProfile.findUnique({ where: { userId: u.id } });
  await db.teacherProfile.update({ where: { userId: u.id }, data: { settings: { ...((prof?.settings as object) ?? {}), payDetails: text.slice(0, 1000) } } });
  refresh();
  return { ok: true };
}

// ───────── Ученик ─────────

/** «Я оплатил(а)»: скриншот или текст. Совпала сумма — оплата принимается сразу. */
export async function iPaid(id: string, proof: { text?: string; file?: string }): Promise<R> {
  const { t } = await getT();
  const { s } = await me();
  const inv = await db.invoice.findUnique({ where: { id } });
  if (!inv || inv.studentId !== s.id || inv.status === "PAID" || inv.status === "CANCELLED") return { ok: false, error: "not found" };
  if (!proof.text?.trim() && !proof.file) return { ok: false, error: t("pay.err.proof") };
  if (proof.file && !proof.file.startsWith("/api/files/")) return { ok: false, error: "file" };
  const auto = await submitProof(inv, proof);
  // Без revalidatePath: он обновил бы и эту страницу, и карточка счёта исчезла бы вместе с сообщением «Оплата принята».
  // Страницу ученика обновляет окно после закрытия; страницы учителя динамические и покажут новое при открытии.
  return { ok: true, auto };
}

/** «Продлить» / «Перейти на абонемент»: счёт за выбранный абонемент. */
export async function buyPack(n: number): Promise<R> {
  const { t } = await getT();
  const { s } = await me();
  const opt = packOptions(s).find((o) => o.n === n);
  if (!opt) return { ok: false, error: t("pay.err.noPrices") };
  if (await db.invoice.count({ where: { studentId: s.id, kind: "pack", status: { in: ["SENT", "PROOF_SENT"] } } })) return { ok: false, error: t("pay.err.openPack") };
  await createInvoice(s, { amount: opt.price, kind: "pack", title: `Абонемент, ${opt.n} занятий`, packLessons: opt.n });
  if (s.payType === "POSTPAID") await notify({ userId: s.teacherId, kind: "pack_request", title: `${s.name} хочет перейти на абонемент (${opt.n} занятий)`, action: "decide", link: `/teacher/students/${s.id}` });
  refresh();
  return { ok: true };
}

/** «Заморозить» и «Мне нужен чек» — готовые сообщения преподавателю. */
export async function payMessage(text: string): Promise<R> {
  const { s } = await me();
  const r = await sendMessage(s.id, text);
  refresh();
  return r;
}
