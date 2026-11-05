import "server-only";
import type { Invoice, Student } from "@prisma/client";
import { db } from "../db";
import { mailInvoice } from "../mail";
import { env } from "../env";
import { publish } from "../live/bus";
import { readStored } from "../storage";
import { ocr } from "../ai/gateway";
import { weeklyReports } from "../roadmap/jobs";
import { notify } from "../notify";
import { pluralForm } from "@/lib/i18n/dict";

const zan = (n: number) => `${n} ${pluralForm("ru", n, ["занятие", "занятия", "занятий"])}`;

// ───────── Цены ─────────

export type PackOption = { n: number; price: number; main?: boolean };

/** Варианты абонементов ученика: из анкеты, иначе — цена урока × количество. */
export function packOptions(s: Pick<Student, "packPrices" | "price">): PackOption[] {
  const list = ((s.packPrices as PackOption[]) ?? []).filter((x) => x.n > 0 && x.price > 0);
  if (list.length) return list.sort((a, b) => a.n - b.n);
  return s.price ? [4, 8, 12].map((n) => ({ n, price: s.price! * n })) : [];
}

/** Суммы в тексте ученика: «перевела 3 000 ₽», «3000р», «3.000». */
export function amountsIn(text: string): number[] {
  return [...text.matchAll(/(\d{1,3}(?:[  .,]\d{3})+|\d{3,7})(?:[.,]\d{1,2})?\s*(?:₽|р\.?|руб|rub)?/gi)]
    .map((m) => Number(m[1].replace(/[  .,]/g, "")))
    .filter((n) => n >= 100);
}

// ───────── Счета ─────────

const RULE_DELAY_MIN: Record<string, number> = { after_5: 5, after_15: 15, after_30: 30, after_60: 60, next_day: 24 * 60 };

export async function createInvoice(s: Student, data: { amount: number; kind: "lessons" | "pack" | "manual"; title: string; period?: string; lessonIds?: string[]; packLessons?: number }) {
  const inv = await db.invoice.create({
    data: {
      studentId: s.id, amount: Math.round(data.amount), kind: data.kind, title: data.title, period: data.period ?? null,
      lessonIds: data.lessonIds ?? [], packLessons: data.packLessons ?? null, payerName: s.payerName, payerContact: s.payerContact,
    },
  });
  if (data.lessonIds?.length) await db.lessonInstance.updateMany({ where: { id: { in: data.lessonIds } }, data: { billedAt: new Date() } });
  await notifyInvoice(s, inv, false);
  return inv;
}

/** Уведомление о счёте ученику (и плательщику, если счёт выставляется другому лицу и указана почта). */
export async function notifyInvoice(s: Student, inv: Invoice, reminder: boolean) {
  const rub = new Intl.NumberFormat("ru-RU").format(inv.amount) + " ₽";
  if (s.userId)
    await notify({ userId: s.userId, kind: "invoice", title: reminder ? `Напоминание: счёт на ${rub} ждёт оплаты` : `Новый счёт на оплату: ${rub}`, action: "decide", link: "/student/payments?tab=bills" });
  if (s.payerContact && /@.+\./.test(s.payerContact) && !s.payerContact.startsWith("@"))
    await mailInvoice(s.payerContact, s.payerName ?? "", `${s.name} ${s.lastName ?? ""}`.trim(), inv.title ?? "", rub, `${env.appUrl}/login`, reminder);
  publish(`student:${s.id}`, "invoice", { id: inv.id });
}

/** Принять оплату: счёт оплачен; для абонемента — новый абонемент. */
export async function acceptInvoice(inv: Invoice, auto: boolean) {
  await db.$transaction(async (tx) => {
    await tx.invoice.update({ where: { id: inv.id }, data: { status: "PAID", paidAt: new Date(), autoAccepted: auto, closedAt: auto ? null : new Date() } });
    if (inv.kind === "pack" && inv.packLessons && !(await tx.pack.findUnique({ where: { invoiceId: inv.id } }))) {
      await tx.pack.create({ data: { studentId: inv.studentId, lessonsTotal: inv.packLessons, lessonsLeft: inv.packLessons, price: inv.amount, invoiceId: inv.id } });
      // уроки, проведённые «в долг» после окончания прошлого абонемента, списываются из нового
      const owed = await tx.lessonInstance.findMany({ where: { studentId: inv.studentId, deductedAt: null, isTrial: false, OR: [{ status: "DONE" }, { status: "MISSED", charged: true }] }, orderBy: { startsAt: "asc" }, take: inv.packLessons });
      if (owed.length) {
        const p = await tx.pack.findUnique({ where: { invoiceId: inv.id } });
        await tx.pack.update({ where: { id: p!.id }, data: { lessonsLeft: { decrement: owed.length } } });
        await tx.lessonInstance.updateMany({ where: { id: { in: owed.map((l) => l.id) } }, data: { deductedAt: new Date() } });
      }
    }
  });
}

/** Отменить приём оплаты (кнопка «Отменить» у автоприёма): счёт снова ждёт проверки. */
export async function undoAccept(inv: Invoice) {
  await db.$transaction(async (tx) => {
    const p = await tx.pack.findUnique({ where: { invoiceId: inv.id } });
    if (p && p.lessonsLeft === p.lessonsTotal) await tx.pack.delete({ where: { id: p.id } });
    await tx.invoice.update({ where: { id: inv.id }, data: { status: inv.proofAt ? "PROOF_SENT" : "SENT", paidAt: null, autoAccepted: false, closedAt: null } });
  });
}

/** Ученик прислал подтверждение. Текст или скриншот (сумму читает ИИ-распознавание): совпала сумма — автоприём, иначе — на проверку учителю. */
export async function submitProof(inv: Invoice, proof: { text?: string; file?: string }) {
  const text = proof.text?.trim().slice(0, 1000) || null;
  let read: { source: string; amounts: number[]; matches: boolean; text?: string; failed?: boolean };
  if (text) { const found = amountsIn(text); read = { source: "text", amounts: found, matches: found.includes(inv.amount) }; }
  else {
    read = { source: "screenshot", amounts: [], matches: false };
    try {
      const key = proof.file!.replace(/^\/api\/files\//, "");
      const file = await readStored(key);
      const st = await db.student.findUnique({ where: { id: inv.studentId }, select: { teacherId: true, userId: true } });
      if (file && st) {
        const mime = key.endsWith(".png") ? "image/png" : key.endsWith(".pdf") ? "application/pdf" : "image/jpeg";
        const seen = await ocr(file.buf, mime, { userId: st.userId ?? "", teacherId: st.teacherId });
        const found = amountsIn(seen);
        read = { source: "screenshot", amounts: found, matches: found.includes(inv.amount), text: seen.slice(0, 400) };
      }
    } catch { read.failed = true; }
  }
  const matches = read.matches;
  await db.invoice.update({
    where: { id: inv.id },
    data: { status: "PROOF_SENT", proofKind: proof.file ? "screenshot" : "text", proofFile: proof.file ?? null, proofText: text, proofAt: new Date(), aiRead: read },
  });
  const fresh = await db.invoice.findUniqueOrThrow({ where: { id: inv.id }, include: { student: true } });
  if (matches) await acceptInvoice(fresh, true);
  await notify({
      userId: fresh.student.teacherId, kind: "payment",
      title: `${fresh.student.name} ${matches ? "оплатил(а)" : "прислал(а) подтверждение оплаты"}: ${new Intl.NumberFormat("ru-RU").format(inv.amount)} ₽`,
      action: matches ? "review" : "check_screenshot", link: "/teacher/finance?tab=check",
    });
  return matches;
}

// ───────── Плановые задачи (раз в минуту) ─────────

/** Списание уроков из абонемента: проведённые и оплачиваемые пропуски. */
async function deductPacks() {
  const lessons = await db.lessonInstance.findMany({
    where: { deductedAt: null, isTrial: false, student: { payType: "PACK" }, OR: [{ status: "DONE" }, { status: "MISSED", charged: true }] },
    orderBy: { startsAt: "asc" },
    take: 500,
  });
  for (const l of lessons) {
    const pack = await db.pack.findFirst({ where: { studentId: l.studentId!, lessonsLeft: { gt: 0 }, OR: [{ frozenUntil: null }, { frozenUntil: { lt: l.startsAt } }] }, orderBy: { startsAt: "asc" } });
    if (!pack) continue; // абонемент закончился — урок спишется из следующего
    await db.$transaction([
      db.pack.update({ where: { id: pack.id }, data: { lessonsLeft: { decrement: 1 } } }),
      db.lessonInstance.update({ where: { id: l.id }, data: { deductedAt: new Date() } }),
    ]);
  }
}

/** Счета за новый абонемент: когда осталось 1 или 2 урока или абонемент закончился. */
async function billPacks() {
  const students = await db.student.findMany({ where: { payType: "PACK", status: "ACTIVE", billRule: { in: ["pack_left_1", "pack_left_2", "pack_end"] } }, include: { packs: { orderBy: { startsAt: "desc" } } } });
  for (const s of students) {
    const left = s.packs.reduce((a, p) => a + p.lessonsLeft, 0);
    const threshold = s.billRule === "pack_left_2" ? 2 : s.billRule === "pack_left_1" ? 1 : 0;
    if (!s.packs.length || left > threshold) continue;
    const open = await db.invoice.count({ where: { studentId: s.id, kind: "pack", status: { in: ["SENT", "PROOF_SENT"] } } });
    if (open) continue; // счёт за абонемент уже выставлен и ждёт оплаты
    const opts = packOptions(s);
    const opt = opts.find((o) => o.main) ?? opts.find((o) => o.n === s.packs[0].lessonsTotal) ?? opts.find((o) => o.n === 8) ?? opts[opts.length - 1];
    if (!opt) continue;
    await createInvoice(s, { amount: opt.price, kind: "pack", title: `Абонемент, ${zan(opt.n)}`, packLessons: opt.n });
  }
}

/** Постоплата: счёт после урока (через 5/15/30/60 мин или на следующий день) или раз в 4 недели. */
async function billPostpaid(now: Date) {
  const students = await db.student.findMany({ where: { payType: "POSTPAID", status: "ACTIVE", billRule: { in: [...Object.keys(RULE_DELAY_MIN), "every_4_weeks"] } } });
  for (const s of students) {
    const unbilled = await db.lessonInstance.findMany({
      where: { studentId: s.id, billedAt: null, NOT: { isTrial: true, OR: [{ price: null }, { price: { lte: 0 } }] }, // платный пробный — в счёт; бесплатный — нет
       OR: [{ status: "DONE" }, { status: "MISSED", charged: true }] },
      orderBy: { startsAt: "asc" },
    });
    if (!unbilled.length) continue;
    let due = unbilled;
    if (s.billRule === "every_4_weeks") {
      const first = await db.lessonInstance.findFirst({ where: { studentId: s.id, isTrial: false, OR: [{ status: "DONE" }, { status: "MISSED", charged: true }] }, orderBy: { startsAt: "asc" } });
      if (!first) continue;
      const periods = Math.floor((now.getTime() - first.startsAt.getTime()) / (28 * 864e5));
      if (periods < 1) continue;
      const boundary = new Date(first.startsAt.getTime() + periods * 28 * 864e5);
      due = unbilled.filter((l) => l.startsAt < boundary);
    } else {
      const delay = RULE_DELAY_MIN[s.billRule!] * 60000;
      due = unbilled.filter((l) => l.startsAt.getTime() + l.durationMin * 60000 + delay <= now.getTime());
    }
    if (!due.length) continue;
    const amount = due.reduce((a, l) => a + (l.price ?? s.price ?? 0), 0);
    if (amount <= 0) continue;
    const fmt = (d: Date) => d.toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: s.timezone });
    await createInvoice(s, {
      amount, kind: "lessons", lessonIds: due.map((l) => l.id),
      title: due.length === 1 ? `Урок ${fmt(due[0].startsAt)}` : `Уроки: ${due.length}`,
      period: due.length > 1 ? `${fmt(due[0].startsAt)} – ${fmt(due[due.length - 1].startsAt)}` : undefined,
    });
  }
}

/** Напоминания о неоплаченных счетах раз в 1 / 3 / 7 дней (из анкеты). */
async function remind(now: Date) {
  const open = await db.invoice.findMany({ where: { status: "SENT" }, include: { student: true } });
  for (const inv of open) {
    const every = inv.student.remindEveryDays;
    if (!every) continue;
    const since = (inv.remindedAt ?? inv.createdAt).getTime();
    if (now.getTime() - since < every * 864e5) continue;
    await db.invoice.update({ where: { id: inv.id }, data: { remindedAt: now, remindCount: { increment: 1 } } });
    await notifyInvoice(inv.student, inv, true);
  }
}

let running = false;
export async function runBilling(now = new Date()) {
  if (running) return;
  running = true;
  try {
    // прошедшие запланированные уроки — проведены (то же, что при открытии расписания, но для всех учителей)
    await db.$executeRaw`UPDATE "LessonInstance" SET status = 'DONE' WHERE status = 'PLANNED' AND "startsAt" + ("durationMin" * interval '1 minute') < (now() at time zone 'UTC')`;
    await deductPacks();
    await billPacks();
    await billPostpaid(now);
    await remind(now);
    await weeklyReports(now);
  } catch (e) {
    console.error("[billing]", e);
  } finally {
    running = false;
  }
}
