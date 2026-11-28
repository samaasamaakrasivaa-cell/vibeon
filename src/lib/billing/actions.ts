"use server";
import { revalidatePath } from "next/cache";
import type { Invoice } from "@prisma/client";
import { db } from "../db";
import { requireUser } from "../auth/session";
import { getT } from "../i18n/server";
import { acceptInvoice, createInvoice, notifyInvoice, packOptions, submitProof, undoAccept } from "./engine";
import { sendMessage } from "../student/actions";
import { completeNotes, notify, notifyPayer } from "../notify";
import { buildMessage } from "../invite";
import { shortCode } from "../auth/crypto";
import { tgEnabled, botUsername } from "../notify/telegram";
import { payable } from "./lesson-pay";
import { lockStudentBilling } from "./pack-usage";
import { pluralForm } from "@/lib/i18n/dict";

const zan = (n: number) => `${n} ${pluralForm("ru", n, ["занятие", "занятия", "занятий"])}`;

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

/** «Оплачено» у проведённого урока — всегда, даже если счёт ещё не выставлен.
 *  Урок в неоплаченном счёте: счёт только за него — счёт оплачен; в счёте за несколько уроков — урок выходит из счёта
 *  (сумма счёта уменьшается) и оплачивается отдельно. Счёта нет — оплата записывается сразу (в финансах — «Получено»). */
export async function confirmLessonPaid(lessonId: string, amount?: number): Promise<R> {
  const { t } = await getT();
  const u = await requireUser("TEACHER");
  const target = await db.lessonInstance.findFirst({ where: { id: lessonId, teacherId: u.id }, select: { studentId: true } });
  const studentId = target?.studentId;
  if (!studentId) return { ok: false, error: t("pay.err.notFound") };

  const result = await db.$transaction(async (tx) => {
    if (!await lockStudentBilling(tx, studentId)) return { error: "pay.err.notFound" } as const;
    const l = await tx.lessonInstance.findFirst({
      where: { id: lessonId, teacherId: u.id, studentId }, include: { student: true },
    });
    if (!l?.student) return { error: "pay.err.notFound" } as const;
    if (!payable(l)) return { error: "pay.err.notPayable" } as const;
    const sum = Math.round(amount && amount > 0 ? amount : l.price ?? l.student.price ?? 0);
    if (!(sum > 0 && sum < 10_000_000)) return { error: "pay.err.noPrice" } as const;

    const invs = await tx.invoice.findMany({ where: { studentId, lessonIds: { has: l.id }, status: { not: "CANCELLED" } } });
    if (invs.some((i) => i.status === "PAID")) return { alreadyPaid: true } as const;
    if (l.deductedAt) return { error: "prof.packAlreadyDeducted" } as const;

    const now = new Date();
    const open = invs[0];
    if (open && open.lessonIds.length === 1) {
      await tx.invoice.update({
        where: { id: open.id },
        data: { status: "PAID", paidAt: now, autoAccepted: false, closedAt: now, ...(amount && amount > 0 ? { amount: sum } : {}) },
      });
    } else {
      if (open) {
        const left = open.lessonIds.filter((id) => id !== l.id);
        await tx.invoice.update({
          where: { id: open.id },
          data: { lessonIds: left, amount: Math.max(0, open.amount - (l.price ?? l.student.price ?? 0)), title: left.length === 1 ? open.title : `Уроки: ${left.length}` },
        });
      }
      const when = l.startsAt.toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: l.student.timezone });
      await tx.invoice.create({ data: {
        studentId, amount: sum, kind: "lessons", title: `Урок ${when}`, lessonIds: [l.id], status: "PAID", paidAt: now,
        closedAt: now, proofKind: "teacher", payerName: l.student.payerName, payerContact: l.student.payerContact,
      } });
    }
    await tx.lessonInstance.update({ where: { id: l.id }, data: {
      billedAt: l.billedAt ?? now,
      ...(l.student.payType === "PACK" && (!open || open.lessonIds.length > 1) ? { deductedAt: now } : {}),
      ...(l.price === null || (amount && amount > 0 && amount !== l.price) ? { price: sum } : {}),
    } });
    return { lesson: l, sum } as const;
  });
  if (result.error) return { ok: false, error: t(result.error) };
  if (result.alreadyPaid) return { ok: true };
  const { lesson: l, sum } = result;
  await checksDone(u.id);
  // ученику — в «Что нового»: преподаватель отметил урок оплаченным
  if (l.student?.userId) {
    const day = l.startsAt.toLocaleDateString("ru-RU", { day: "numeric", month: "long", timeZone: l.student.timezone });
    await notify({ userId: l.student.userId, kind: "paid", title: `Преподаватель отметил оплату урока ${day}: ${new Intl.NumberFormat("ru-RU").format(sum)} ₽. Спасибо!`, link: "/student/payments?tab=bills" }).catch(() => null);
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
    if (!await lockStudentBilling(tx, inv.studentId)) return "unchanged";
    const current = await tx.invoice.findFirst({ where: { id: inv.id, studentId: inv.studentId, status: "PAID" } });
    if (!current) return "unchanged";
    if (current.proofKind === "teacher") await tx.invoice.delete({ where: { id: current.id } });
    else await tx.invoice.update({ where: { id: current.id }, data: { status: "CANCELLED", paidAt: null, closedAt: null, autoAccepted: false } });
    await tx.lessonInstance.updateMany({ where: { id: { in: current.lessonIds } }, data: { billedAt: null, deductedAt: null, payLaterAt: null, noBill: true } });
    return "ok";
  });
}

/** Отменить подтверждение оплаты (нажали по ошибке) — сутки после подтверждения, в «Финансах» → «Недавние оплаты». */
export async function undoPaid(invoiceId: string): Promise<R> {
  const inv = await teacherInvoice(invoiceId);
  if (inv.status !== "PAID") return { ok: true };
  if (await reopenPaid(inv) === "used") return { ok: false, error: (await getT()).t("pay.err.packUsed") };
  refresh();
  return { ok: true };
}

/** Отменить «Оплачено», отмеченное у урока (по ошибке): запись об оплате удаляется, урок снова не оплачен. */
export async function undoLessonPaid(lessonId: string): Promise<R> {
  const { t } = await getT();
  const u = await requireUser("TEACHER");
  const l = await db.lessonInstance.findUnique({ where: { id: lessonId } });
  if (!l || l.teacherId !== u.id || !l.studentId) return { ok: false, error: t("pay.err.notFound") };
  const inv = await db.invoice.findFirst({ where: { studentId: l.studentId, lessonIds: { has: l.id }, status: "PAID" } });
  if (!inv) return { ok: true };
  if (await reopenPaid(inv) === "used") return { ok: false, error: (await getT()).t("pay.err.packUsed") };
  refresh();
  return { ok: true };
}

/** «Отметить оплату» — учитель сам подтверждает оплату. */
/** Все чеки проверены — уведомления «Проверить скриншот» сделаны. */
async function checksDone(teacherId: string) {
  if (!(await db.invoice.count({ where: { student: { teacherId }, status: "PROOF_SENT" } })))
    await completeNotes(teacherId, { linkStarts: "/teacher/finance" });
}

export async function markPaid(id: string): Promise<R> {
  const inv = await teacherInvoice(id);
  if (inv.status === "PAID" || !await acceptInvoice(inv, false)) return { ok: true };
  await checksDone(inv.student.teacherId);
  await notifyPayer(inv.studentId, `Оплата ${new Intl.NumberFormat("ru-RU").format(inv.amount)} ₽ за занятия английским (${inv.student.name}) получена. Спасибо!`);
  if (inv.student.userId) await notify({ userId: inv.student.userId, kind: "paid", title: `Оплата получена: ${new Intl.NumberFormat("ru-RU").format(inv.amount)} ₽. Спасибо!`, link: "/student/payments?tab=bills" });
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
  let amount = Math.round(Number(input.amount ?? inv.amount));
  if (input.lessons?.length) {
    const ls = input.lessons.filter((l) => inv.lessonIds.includes(l.id));
    if (ls.some((l) => !ok(l.price))) return { ok: false, error: t("sch.priceBad") };
    for (const l of ls) await db.lessonInstance.update({ where: { id: l.id }, data: { price: Math.round(Number(l.price)) } });
    const all = await db.lessonInstance.findMany({ where: { id: { in: inv.lessonIds } }, select: { price: true } });
    amount = all.reduce((a, l) => a + (l.price ?? 0), 0);
  }
  if (!ok(amount) || amount <= 0) return { ok: false, error: t("sch.priceBad") };
  await db.invoice.update({ where: { id }, data: { amount } });
  refresh();
  return { ok: true };
}

/** «ОК» у автоматически принятой оплаты — строка закрывается. */
export async function closeInvoice(id: string): Promise<R> {
  await teacherInvoice(id);
  const inv = await db.invoice.update({ where: { id }, data: { closedAt: new Date() }, include: { student: true } });
  await checksDone(inv.student.teacherId);
  refresh();
  return { ok: true };
}

/** «Отменить» — автоприём отменяется, счёт снова ждёт проверки. */
export async function undoAuto(id: string): Promise<R> {
  const inv = await teacherInvoice(id);
  if (await undoAccept(inv) === "used") return { ok: false, error: (await getT()).t("pay.err.packUsed") };
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
  const result = await db.$transaction(async (tx) => {
    if (!await lockStudentBilling(tx, inv.studentId)) return "unchanged";
    const current = await tx.invoice.findFirst({ where: { id: inv.id, studentId: inv.studentId } });
    if (!current || current.status === "CANCELLED") return "unchanged";
    if (current.kind === "pack" && current.status === "PAID") {
      const pack = await tx.pack.findUnique({ where: { invoiceId: current.id } });
      return pack && (pack.used || pack.lessonsLeft !== pack.lessonsTotal) ? "used" : "paid";
    }
    await tx.invoice.update({ where: { id: current.id }, data: { status: "CANCELLED" } });
    if (current.lessonIds.length) await tx.lessonInstance.updateMany({ where: { id: { in: current.lessonIds } }, data: { billedAt: null } });
    return "ok";
  });
  if (result === "used" || result === "paid") {
    const { t } = await getT();
    return { ok: false, error: t(result === "used" ? "pay.err.packUsed" : "pay.err.packUndoFirst") };
  }
  refresh();
  return { ok: true };
}

/** Выставить счёт сейчас: постоплата — за все проведённые и ещё не оплаченные уроки. */
export async function billNow(studentId: string): Promise<R> {
  const { t } = await getT();
  const s = await ownStudent(studentId);
  const lessons = await db.lessonInstance.findMany({ where: { studentId, billedAt: null, deductedAt: null, NOT: { isTrial: true, OR: [{ price: null }, { price: { lte: 0 } }] }, // платный пробный — в счёт; бесплатный — нет
       OR: [{ status: "DONE" }, { status: "MISSED", charged: true }] }, orderBy: { startsAt: "asc" } });
  if (!lessons.length) return { ok: false, error: t("pay.err.nothingToBill") };
  const amount = lessons.reduce((a, l) => a + (l.price ?? s.price ?? 0), 0);
  const invoice = await createInvoice(s, { amount, kind: "lessons", lessonIds: lessons.map((l) => l.id), title: lessons.length === 1 ? "Урок" : `Уроки: ${lessons.length}` });
  if (!invoice) return { ok: false, error: t("pay.err.nothingToBill") };
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
