"use server";
import { revalidatePath } from "next/cache";
import type { Invoice } from "@prisma/client";
import { db } from "../db";
import { requireUser } from "../auth/session";
import { getT } from "../i18n/server";
import { fileUrl } from "../storage";
import { lockStudentBilling } from "./pack-usage";
import { invoiceDocumentAccess, invoiceDocumentStates, invoiceForDocumentWrite, paymentDocumentField, paymentKinds, paymentUploadForWrite, usablePaymentUpload, type PaymentDocument } from "./documents";
import { acceptInvoice, acceptInvoiceInTransaction, createInvoice, notifyInvoice, packOptions, submitProof, undoAccept } from "./engine";
import { sendMessage } from "../student/actions";
import { completeNotes, deliverPending, notify, notifyPayer } from "../notify";
import { buildMessage } from "../invite";
import { shortCode } from "../auth/crypto";
import { tgEnabled, botUsername } from "../notify/telegram";
import { payable } from "./lesson-pay";
import { pluralForm } from "@/lib/i18n/dict";

const zan = (n: number) => `${n} ${pluralForm("ru", n, ["занятие", "занятия", "занятий"])}`;

export type R = { ok: true; auto?: boolean } | { ok: false; error: string };
const refresh = () => { revalidatePath("/teacher", "layout"); revalidatePath("/student", "layout"); };

async function teacherInvoice(id: string) {
  const me = await requireUser("TEACHER");
  const inv = await db.invoice.findFirst({ where: { id, ...invoiceDocumentAccess(me) }, include: { student: true } });
  if (!inv) throw new Error("not found");
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

/** «Оплачено» у проведённого урока — всегда, даже если счёт ещё не выставлен.
 *  Урок в неоплаченном счёте: счёт только за него — счёт оплачен; в счёте за несколько уроков — урок выходит из счёта
 *  (сумма счёта уменьшается) и оплачивается отдельно. Счёта нет — оплата записывается сразу (в финансах — «Получено»). */
export async function confirmLessonPaid(lessonId: string, amount?: number): Promise<R> {
  const { t } = await getT();
  const u = await requireUser("TEACHER");
  const l = await db.lessonInstance.findUnique({ where: { id: lessonId }, include: { student: true } });
  if (!l || l.teacherId !== u.id || !l.student) return { ok: false, error: t("pay.err.notFound") };
  const result = await db.$transaction(async (tx) => {
    if (!await lockStudentBilling(tx, l.student!.id)) return { error: "pay.err.notFound" } as const;
    const current = await tx.lessonInstance.findFirst({ where: { id: lessonId, teacherId: u.id, studentId: l.student!.id }, include: { student: true } });
    if (!current?.student) return { error: "pay.err.notFound" } as const;
    if (!payable(current)) return { error: "pay.err.notPayable" } as const;
    const s = current.student;
    const sum = Math.round(amount && amount > 0 ? amount : current.price ?? s.price ?? 0);
    if (!(sum > 0 && sum < 10_000_000)) return { error: "pay.err.noPrice" } as const;
    const invs = await tx.invoice.findMany({ where: { studentId: s.id, lessonIds: { has: current.id }, status: { not: "CANCELLED" } } });
    if (invs.some((i) => i.status === "PAID")) return { unchanged: true } as const;
    if (current.deductedAt) return { error: "pay.err.notPayable" } as const;
    const open = invs[0];
    const now = new Date();
    if (open && open.lessonIds.length === 1) {
      if (amount && amount > 0 && amount !== open.amount) await tx.invoice.update({ where: { id: open.id }, data: { amount: sum } });
      await acceptInvoiceInTransaction(tx, open, false);
    } else {
      if (open) {
        const left = open.lessonIds.filter((id) => id !== current.id);
        await tx.invoice.update({ where: { id: open.id }, data: {
          lessonIds: left, amount: Math.max(0, open.amount - (current.price ?? s.price ?? 0)),
          title: left.length === 1 ? open.title : `Уроки: ${left.length}`, revision: { increment: 1 },
        } });
      }
      const when = current.startsAt.toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: s.timezone });
      await tx.invoice.create({ data: {
        studentId: s.id, amount: sum, kind: "lessons", title: `Урок ${when}`, lessonIds: [current.id],
        status: "PAID", paidAt: now, closedAt: now, proofKind: "teacher", payerName: s.payerName, payerContact: s.payerContact,
      } });
    }
    await tx.lessonInstance.update({
      where: { id: current.id },
      data: { billedAt: current.billedAt ?? now, price: current.price === null || !!amount && amount > 0 ? sum : undefined },
    });
    return { student: s, sum, at: current.startsAt } as const;
  });
  if (result.error) return { ok: false, error: t(result.error) };
  if ("unchanged" in result) return { ok: true };
  await checksDone(u.id);
  if (result.student.userId) {
    const day = result.at.toLocaleDateString("ru-RU", { day: "numeric", month: "long", timeZone: result.student.timezone });
    await notify({ userId: result.student.userId, kind: "paid", title: `Преподаватель отметил оплату урока ${day}: ${new Intl.NumberFormat("ru-RU").format(result.sum)} ₽. Спасибо!`, link: "/student/payments?tab=bills" }).catch(() => null);
  }
  refresh();
  return { ok: true };
}

/** «Оплатит позже» у проведённого урока без счёта (постоплата за неделю/месяц): урок уходит из «Проведённые уроки без счёта»
 *  в список «Оплатит позже» — копится там, в «Ждём оплаты» остаётся. back — вернуть обратно. */
export async function payLater(lessonId: string, back = false): Promise<R> {
  const { t } = await getT();
  const u = await requireUser("TEACHER");
  const l = await db.lessonInstance.findUnique({ where: { id: lessonId } });
  if (!l || l.teacherId !== u.id || !l.studentId) return { ok: false, error: t("pay.err.notFound") };
  await db.lessonInstance.update({ where: { id: l.id }, data: { payLaterAt: back ? null : new Date() } });
  refresh();
  return { ok: true };
}

/** Оплату за уроки отменили (нажали «Оплачено» / «Отметить оплату» по ошибке): счёт снимается, уроки снова
 *  в «Проведённые уроки без счёта» — с «Оплачено» и «Оплатит позже». Новый счёт за них сам не выставляется.
 *  Счёт за абонемент — обратно в ожидание оплаты (абонемент, если ещё не начат, снимается). */
async function reopenPaid(inv: Invoice) {
  if (inv.kind === "pack" || !inv.lessonIds.length) return undoAccept(inv);
  return db.$transaction(async (tx) => {
    if (!await lockStudentBilling(tx, inv.studentId)) return "stale";
    const where = { id: inv.id, studentId: inv.studentId, status: "PAID" as const, revision: inv.revision };
    const change = await tx.invoice.updateMany({
      where, data: { status: "CANCELLED", paidAt: null, closedAt: null, autoAccepted: false, revision: { increment: 1 } },
    });
    if (!change.count) return "stale";
    await tx.lessonInstance.updateMany({ where: { id: { in: inv.lessonIds } }, data: { billedAt: null, deductedAt: null, payLaterAt: null, noBill: true } });
    return "ok";
  });
}

async function reportPaymentUndo(result: Awaited<ReturnType<typeof reopenPaid>>): Promise<R> {
  if (result !== "ok") {
    const { t } = await getT();
    return { ok: false, error: t(result === "used" ? "pay.err.packUsed" : "pay.err.stale") };
  }
  refresh();
  return { ok: true };
}

/** Отменить подтверждение оплаты в «Финансах» → «Недавние оплаты». */
export async function undoPaid(invoiceId: string): Promise<R> {
  const inv = await teacherInvoice(invoiceId);
  if (inv.status !== "PAID") return { ok: true };
  return reportPaymentUndo(await reopenPaid(inv));
}

/** Отменить «Оплачено», отмеченное у урока (по ошибке). */
export async function undoLessonPaid(lessonId: string): Promise<R> {
  const { t } = await getT();
  const u = await requireUser("TEACHER");
  const l = await db.lessonInstance.findUnique({ where: { id: lessonId } });
  if (!l || l.teacherId !== u.id || !l.studentId) return { ok: false, error: t("pay.err.notFound") };
  const inv = await db.invoice.findFirst({ where: { studentId: l.studentId, lessonIds: { has: l.id }, status: "PAID" } });
  if (!inv) return { ok: true };
  return reportPaymentUndo(await reopenPaid(inv));
}

/** «Отметить оплату» — учитель сам подтверждает оплату. */
/** Все чеки проверены — уведомления «Проверить скриншот» сделаны. */
async function checksDone(teacherId: string) {
  if (!(await db.invoice.count({ where: { student: { teacherId }, status: "PROOF_SENT" } })))
    await completeNotes(teacherId, { linkStarts: "/teacher/finance" });
}

export async function markPaid(id: string): Promise<R> {
  const inv = await teacherInvoice(id);
  if (inv.status === "PAID") return { ok: true };
  if (!await acceptInvoice(inv, false)) {
    const { t } = await getT();
    return { ok: false, error: t("pay.err.stale") };
  }
  void deliverPending().catch(() => undefined);
  await checksDone(inv.student.teacherId).catch(() => undefined);
  await notifyPayer(inv.studentId, `Оплата ${new Intl.NumberFormat("ru-RU").format(inv.amount)} ₽ за занятия английским (${inv.student.name}) получена. Спасибо!`).catch(() => undefined);
  refresh();
  return { ok: true };
}

/** Счёт для правки: сумма и уроки в нём (дата, цена). */
export async function invoiceDetails(id: string) {
  const inv = await teacherInvoice(id);
  const ls = inv.lessonIds.length ? await db.lessonInstance.findMany({ where: { id: { in: inv.lessonIds } }, select: { id: true, startsAt: true, price: true }, orderBy: { startsAt: "asc" } }) : [];
  return { amount: inv.amount, status: inv.status, title: inv.title, lessons: ls.map((l) => ({ id: l.id, at: l.startsAt.toISOString(), price: l.price ?? inv.student.price ?? 0 })) };
}

/** Исправить счёт (и оплаченный — если при отметке оплаты не заметили, что сумма неверная): цены уроков в нём
 *  или сумму целиком. Уроки получают новую цену — расписание и «заработано» считаются по ней. */
export async function updateInvoice(id: string, input: { amount?: number; lessons?: { id: string; price: number }[] }): Promise<R> {
  const { t } = await getT();
  const inv = await teacherInvoice(id);
  if (inv.status === "CANCELLED") return { ok: false, error: t("pay.editCancelled") };
  const ok = (n: unknown) => Number.isFinite(Number(n)) && Number(n) >= 0 && Number(n) < 10_000_000;
  const edits = new Map((input.lessons ?? []).filter((l) => inv.lessonIds.includes(l.id)).map((l) => [l.id, Number(l.price)]));
  if ([...edits.values()].some((price) => !ok(price))) return { ok: false, error: t("sch.priceBad") };
  const result = await db.$transaction(async (tx) => {
    if (!await lockStudentBilling(tx, inv.studentId)) return "stale";
    if (!await tx.invoice.findFirst({ where: { id, revision: inv.revision } })) return "stale";
    let amount = Math.round(Number(input.amount ?? inv.amount));
    if (edits.size) {
      const lessons = await tx.lessonInstance.findMany({ where: { id: { in: inv.lessonIds } }, select: { id: true, price: true } });
      amount = lessons.reduce((sum, lesson) => sum + Math.round(edits.get(lesson.id) ?? lesson.price ?? 0), 0);
    }
    if (!ok(amount) || amount <= 0) return "invalid";
    for (const [lessonId, price] of edits) await tx.lessonInstance.update({ where: { id: lessonId }, data: { price: Math.round(price) } });
    await tx.invoice.update({ where: { id }, data: { amount, revision: { increment: 1 } } });
    return "ok";
  });
  if (result === "invalid") return { ok: false, error: t("sch.priceBad") };
  return reportPaymentUndo(result);
}

/** «ОК» у автоматически принятой оплаты — строка закрывается. */
export async function closeInvoice(id: string): Promise<R> {
  const inv = await teacherInvoice(id);
  const changed = await db.$transaction(async (tx) => {
    if (!await lockStudentBilling(tx, inv.studentId)) return false;
    const change = await tx.invoice.updateMany({
      where: { id, status: "PAID", autoAccepted: true, revision: inv.revision, closedAt: null },
      data: { closedAt: new Date(), revision: { increment: 1 } },
    });
    return !!change.count;
  });
  if (!changed) return reportPaymentUndo("stale");
  await checksDone(inv.student.teacherId);
  refresh();
  return { ok: true };
}

/** «Отменить» — автоприём отменяется, счёт снова ждёт проверки. */
export async function undoAuto(id: string): Promise<R> {
  const inv = await teacherInvoice(id);
  return reportPaymentUndo(await undoAccept(inv, { auto: true }));
}

/** Подтверждение не подошло — счёт снова ждёт оплаты, ученику уведомление. */
export async function rejectProof(id: string, comment: string): Promise<R> {
  const inv = await teacherInvoice(id);
  const change = await db.$transaction(async (tx) => {
    if (!await lockStudentBilling(tx, inv.studentId)) return false;
    const result = await tx.invoice.updateMany({
      where: { id, status: "PROOF_SENT", revision: inv.revision },
      data: { status: "SENT", autoAccepted: false, revision: { increment: 1 } },
    });
    if (!result.count) return false;
    if (inv.student.userId) await notify({
      userId: inv.student.userId, kind: "invoice",
      title: `Оплата не найдена${comment ? `: ${comment.slice(0, 100)}` : ""}. Проверь, пожалуйста`,
      action: "decide", link: "/student/payments?tab=bills",
    }, tx);
    return true;
  });
  if (!change) return reportPaymentUndo("stale");
  void deliverPending().catch(() => undefined);
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
  const result = await db.$transaction(async (tx) => {
    if (!await lockStudentBilling(tx, inv.studentId)) return "stale";
    const current = await tx.invoice.findUnique({ where: { id } });
    if (!current) return "stale";
    if (current.status === "CANCELLED") return "ok";
    if (current.status === "PAID") {
      const pack = await tx.pack.findUnique({ where: { invoiceId: id } });
      return pack && (pack.used || pack.lessonsLeft !== pack.lessonsTotal) ? "used" : "stale";
    }
    if (current.revision !== inv.revision) return "stale";
    await tx.invoice.update({ where: { id }, data: { status: "CANCELLED", revision: { increment: 1 } } });
    if (current.lessonIds.length) {
      await tx.lessonInstance.updateMany({ where: { id: { in: current.lessonIds } }, data: { billedAt: null } });
    }
    return "ok";
  });
  return reportPaymentUndo(result);
}

/** Выставить счёт сейчас: постоплата — за все проведённые и ещё не оплаченные уроки. */
export async function billNow(studentId: string): Promise<R> {
  const { t } = await getT();
  const s = await ownStudent(studentId);
  const lessons = await db.lessonInstance.findMany({ where: { studentId, billedAt: null, NOT: { isTrial: true, OR: [{ price: null }, { price: { lte: 0 } }] }, // платный пробный — в счёт; бесплатный — нет
       OR: [{ status: "DONE" }, { status: "MISSED", charged: true }] }, orderBy: { startsAt: "asc" } });
  if (!lessons.length) return { ok: false, error: t("pay.err.nothingToBill") };
  const amount = lessons.reduce((a, l) => a + (l.price ?? s.price ?? 0), 0);
  if (!await createInvoice(s, { amount, kind: "lessons", lessonIds: lessons.map((l) => l.id), title: lessons.length === 1 ? "Урок" : `Уроки: ${lessons.length}` })) {
    return reportPaymentUndo("stale");
  }
  refresh();
  return { ok: true };
}

/** «Запросить оплату за новый абонемент». */
export async function requestPackPayment(studentId: string, n?: number): Promise<R> {
  const { t } = await getT();
  const s = await ownStudent(studentId);
  const opts = packOptions(s);
  const opt = opts.find((o) => o.n === n) ?? opts.find((o) => o.main) ?? opts.find((o) => o.n === 8) ?? opts[opts.length - 1];
  if (!opt) return { ok: false, error: t("pay.err.noPrices") };
  if (await db.invoice.count({ where: { studentId, kind: "pack", status: { in: ["SENT", "PROOF_SENT"] } } })) return { ok: false, error: t("pay.err.openPack") };
  await createInvoice(s, { amount: opt.price, kind: "pack", title: `Абонемент, ${zan(opt.n)}`, packLessons: opt.n });
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

async function bindPaymentDocument(id: string, kind: PaymentDocument, uploadId: string): Promise<R> {
  const actor = await requireUser(kind === "receipt" ? "TEACHER" : "STUDENT");
  const { t } = await getT();
  if (typeof id !== "string" || typeof uploadId !== "string" || !uploadId) return { ok: false, error: t("pay.documentError") };
  const invoice = await invoiceForDocumentWrite(id, kind, actor);
  if (!invoice) return { ok: false, error: t("pay.err.stale") };
  const field = paymentDocumentField(kind);
  const previous = invoice[field];
  const restored = !!previous;
  if (!restored && (kind === "proof" || invoice.status === "CANCELLED")) return { ok: false, error: t("pay.documentError") };

  const upload = await paymentUploadForWrite(uploadId, id, kind, actor.id);
  if (!upload) return { ok: false, error: t("pay.documentError") };
  const next = fileUrl(upload.path);
  if (next === previous) return { ok: true };
  if (upload.paymentRevision !== invoice.revision || !await usablePaymentUpload(upload)) return { ok: false, error: t("pay.err.stale") };
  if (restored) {
    const state = (await invoiceDocumentStates([invoice]))(invoice, kind);
    if (state.href || state.pending) return { ok: false, error: t(state.pending ? "pay.documentPending" : "pay.documentExists") };
  }

  const changed = await db.$transaction(async (tx) => {
    if (!await lockStudentBilling(tx, invoice.studentId)) return false;
    const priorVersion = await tx.invoiceDocumentVersion.findUnique({ where: { uploadId } });
    if (priorVersion) {
      const current = await tx.invoice.findFirst({ where: { id, ...invoiceDocumentAccess(actor) }, select: { proofFile: true, receiptFile: true } });
      return current?.[field] === next;
    }
    const result = await tx.invoice.updateMany({
      where: { id, ...invoiceDocumentAccess(actor), studentId: invoice.studentId, revision: invoice.revision, [field]: previous },
      data: { [field]: next, revision: { increment: 1 } },
    });
    if (!result.count) return false;
    await tx.invoiceDocumentVersion.create({ data: { uploadId, invoiceId: id, kind: paymentKinds[kind], previous, actorId: actor.id, restored } });
    if (!restored && kind === "receipt" && invoice.student.userId) await notify({
      userId: invoice.student.userId, kind: "receipt", title: "Преподаватель прикрепил чек к оплате", link: "/student/payments?tab=bills",
    }, tx);
    return true;
  });
  if (!changed) return { ok: false, error: t("pay.err.stale") };
  if (!restored) void deliverPending().catch(() => undefined);
  refresh();
  return { ok: true };
}

/** Прикрепить первый чек или восстановить недоступный чек. */
export async function attachReceipt(id: string, uploadId: string): Promise<R> {
  return bindPaymentDocument(id, "receipt", uploadId);
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
  const actor = await requireUser("STUDENT");
  const { t } = await getT();
  if (typeof id !== "string" || !proof ||
      (proof.text !== undefined && typeof proof.text !== "string") ||
      (proof.file !== undefined && typeof proof.file !== "string")) return { ok: false, error: t("pay.documentError") };
  if (!proof.text?.trim() && !proof.file) return { ok: false, error: t("pay.err.proof") };
  const result = await submitProof(id, actor, proof);
  // Окно успешной отправки закрывается до обновления списка счетов.
  if (!result.ok && result.error === "file") return { ok: false, error: t("pay.documentError") };
  if (!result.ok && result.error === "stale") return reportPaymentUndo("stale");
  if (result.ok) void deliverPending().catch(() => undefined);
  return result;
}

/** Восстановить недоступное подтверждение без перерасчёта платежа или OCR. */
export async function replacePaymentProof(id: string, uploadId: string): Promise<R> {
  return bindPaymentDocument(id, "proof", uploadId);
}

/** «Продлить» / «Перейти на абонемент»: счёт за выбранный абонемент. */
export async function buyPack(n: number): Promise<R> {
  const { t } = await getT();
  const { s } = await me();
  const opt = packOptions(s).find((o) => o.n === n);
  if (!opt) return { ok: false, error: t("pay.err.noPrices") };
  if (await db.invoice.count({ where: { studentId: s.id, kind: "pack", status: { in: ["SENT", "PROOF_SENT"] } } })) return { ok: false, error: t("pay.err.openPack") };
  await createInvoice(s, { amount: opt.price, kind: "pack", title: `Абонемент, ${zan(opt.n)}`, packLessons: opt.n });
  if (s.payType === "POSTPAID") await notify({ userId: s.teacherId, kind: "pack_request", title: `${s.name} хочет перейти на абонемент (${zan(opt.n)})`, action: "decide", link: `/teacher/students/${s.id}` });
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

/** Ссылка для плательщика: открывает бота VibeOn в Telegram, «Старт» — и ему приходят уроки, отзывы, счета. */
export async function payerLinkAction(studentId: string): Promise<{ ok: boolean; link?: string; msg?: string; error?: string }> {
  const { lang } = await getT();
  const u = await requireUser("TEACHER");
  const s = await db.student.findFirst({ where: { id: studentId, teacherId: u.id } });
  if (!s?.payerName) return { ok: false, error: "no payer" };
  if (!tgEnabled()) return { ok: false, error: "bot off" };
  const token = s.payerTgToken ?? shortCode(12);
  if (!s.payerTgToken) await db.student.update({ where: { id: s.id }, data: { payerTgToken: token } });
  const link = `https://t.me/${await botUsername()}?start=p_${token}`;
  const name = (s.payerName.split(/\s[—–-]\s/).pop() ?? s.payerName).trim();
  return { ok: true, link, msg: await buildMessage(u.id, "payer", lang, { name, teacher: [u.name, u.lastName].filter(Boolean).join(" "), link, child: s.name }) };
}
