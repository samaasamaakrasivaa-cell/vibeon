import { weeklyMoments } from "../teacher/moment-digest";
import "server-only";
import { backfillTelegram } from "../notify/bot";
import type { Invoice, Prisma, Student, User } from "@prisma/client";
import { db } from "../db";
import { mailInvoice } from "../mail";
import { env } from "../env";
import { publish } from "../live/bus";
import { fileUrl } from "../storage";
import { lockStudentBilling, spendPackLesson } from "./pack-usage";
import { invoiceDocumentAccess, invoiceForDocumentWrite, paymentUploadForWrite, readPaymentDocument } from "./documents";
import { ocr } from "../ai/gateway";
import { weeklyReports } from "../roadmap/jobs";
import { notify, notifyPayer } from "../notify";
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

// ───────── Цена уроков ─────────

/** Цена из анкеты (или цена группы) — во все ещё не оплаченные уроки ученика: будущие, проведённые без счёта и в счетах,
 *  которые ещё ждут оплаты; суммы таких счетов пересчитываются. Уроки из абонемента — тоже (деньги за них — в абонементе). Оплаченные по счёту уроки не меняются. */
export async function repriceLessons(studentId: string) {
  await db.$transaction(async (tx) => {
    if (!await lockStudentBilling(tx, studentId)) return;
    const s = await tx.student.findUnique({ where: { id: studentId } });
    if (!s) return;
    const open = await tx.invoice.findMany({ where: { studentId, kind: "lessons", status: "SENT" } });
    const openIds = open.flatMap((i) => i.lessonIds);
    const lessons = await tx.lessonInstance.findMany({
      // урок из абонемента: деньги — за абонемент, цена урока лишь показывает, сколько он стоит, — тоже по анкете
      where: { studentId, isTrial: false, status: { not: "CANCELLED" }, OR: [{ billedAt: null }, { id: { in: openIds } }] },
      select: { id: true, price: true, groupId: true, group: { select: { price: true } } },
    });
    const byPrice = new Map<number, string[]>();
    for (const l of lessons) {
      const target = (l.groupId ? l.group?.price : null) ?? s.price; // групповое занятие — по цене группы, если она задана
      if (target == null || l.price === target) continue;
      byPrice.set(target, [...(byPrice.get(target) ?? []), l.id]);
    }
    for (const [price, ids] of byPrice) await tx.lessonInstance.updateMany({ where: { id: { in: ids } }, data: { price } });
    for (const inv of open) {
      if (!inv.lessonIds.length) continue;
      const ls = await tx.lessonInstance.findMany({ where: { id: { in: inv.lessonIds } }, select: { price: true } });
      const amount = ls.reduce((a, l) => a + (l.price ?? s.price ?? 0), 0);
      if (amount > 0 && amount !== inv.amount) await tx.invoice.update({ where: { id: inv.id }, data: { amount, revision: { increment: 1 } } });
    }
  });
}

// ───────── Счета ─────────

const RULE_DELAY_MIN: Record<string, number> = { after_5: 5, after_15: 15, after_30: 30, after_60: 60, next_day: 24 * 60 };

export async function createInvoice(s: Student, data: { amount: number; kind: "lessons" | "pack" | "manual"; title: string; period?: string; lessonIds?: string[]; packLessons?: number }) {
  const inv = await db.$transaction(async (tx) => {
    if (!await lockStudentBilling(tx, s.id)) return null;
    if (data.kind === "pack" && await tx.invoice.count({
      where: { studentId: s.id, kind: "pack", status: { in: ["SENT", "PROOF_SENT"] } },
    })) return null;
    const lessonIds = [...new Set(data.lessonIds)];
    if (lessonIds.length) {
      const eligible = { id: { in: lessonIds }, studentId: s.id, billedAt: null, deductedAt: null };
      if (await tx.lessonInstance.count({ where: eligible }) !== lessonIds.length) return null;
      const claim = await tx.lessonInstance.updateMany({ where: eligible, data: { billedAt: new Date() } });
      if (claim.count !== lessonIds.length) throw new Error("Invoice lessons changed while being credited");
    }
    return tx.invoice.create({
      data: {
        studentId: s.id, amount: Math.round(data.amount), kind: data.kind, title: data.title, period: data.period ?? null,
        lessonIds, packLessons: data.packLessons ?? null, payerName: s.payerName, payerContact: s.payerContact,
      },
    });
  });
  if (inv) await notifyInvoice(s, inv, false);
  return inv;
}

/** Уведомление о счёте ученику (и плательщику, если счёт выставляется другому лицу и указана почта). */
export async function notifyInvoice(s: Student, inv: Invoice, reminder: boolean) {
  const rub = new Intl.NumberFormat("ru-RU").format(inv.amount) + " ₽";
  if (s.userId)
    await notify({ userId: s.userId, kind: "invoice", title: `${reminder ? `Напоминание: счёт на ${rub} ждёт оплаты` : `Новый счёт на оплату: ${rub}`}${inv.kind === "lessons" && inv.title ? ` — ${inv.title}` : ""}`, action: "decide", link: "/student/payments?tab=bills" });
  if (s.payerContact && /@.+\./.test(s.payerContact) && !s.payerContact.startsWith("@"))
    await mailInvoice(s.payerContact, s.payerName ?? "", `${s.name} ${s.lastName ?? ""}`.trim(), inv.title ?? "", rub, `${env.appUrl}/login`, reminder);
  if (s.payerChatId) {
    const prof = await db.teacherProfile.findUnique({ where: { userId: s.teacherId }, select: { settings: true } });
    const details = (prof?.settings as { payDetails?: string } | null)?.payDetails;
    await notifyPayer(s.id, `${reminder ? "Напоминание: ждёт оплаты счёт" : "Новый счёт"} за занятия английским (${s.name}): ${rub}${inv.title ? ` — ${inv.title}` : ""}.${details ? `\nРеквизиты: ${details}` : ""}`);
  }
  publish(`student:${s.id}`, "invoice", { id: inv.id });
}

/** Принять оплату: счёт оплачен; для абонемента — новый абонемент. */
export async function acceptInvoiceInTransaction(tx: Prisma.TransactionClient, inv: Invoice, auto: boolean) {
  await tx.invoice.update({ where: { id: inv.id }, data: { status: "PAID", paidAt: new Date(), autoAccepted: auto, closedAt: auto ? null : new Date(), revision: { increment: 1 } } });
  if (inv.kind === "pack" && inv.packLessons && !(await tx.pack.findUnique({ where: { invoiceId: inv.id } }))) {
    const pack = await tx.pack.create({ data: { studentId: inv.studentId, lessonsTotal: inv.packLessons, lessonsLeft: inv.packLessons, price: inv.amount, invoiceId: inv.id } });
    // уроки, проведённые «в долг» после окончания прошлого абонемента, списываются из нового
    // урок, который учитель «вернул» в абонемент (charged = false), повторно не списывается
    const owed = await tx.lessonInstance.findMany({
      where: { studentId: inv.studentId, deductedAt: null, billedAt: null, isTrial: false, charged: true, status: { in: ["DONE", "MISSED"] } },
      orderBy: [{ startsAt: "asc" }, { id: "asc" }], take: inv.packLessons, select: { id: true },
    });
    for (const lesson of owed) await spendPackLesson(tx, pack, lesson.id);
  }
}

export async function acceptInvoice(inv: Invoice, auto: boolean) {
  return db.$transaction(async (tx) => {
    if (!await lockStudentBilling(tx, inv.studentId)) return false;
    const current = await tx.invoice.findFirst({
      where: { id: inv.id, studentId: inv.studentId, status: inv.status, revision: inv.revision },
    });
    if (!current || current.status === "PAID" || current.status === "CANCELLED") return false;
    await acceptInvoiceInTransaction(tx, current, auto);
    const student = await tx.student.findUnique({ where: { id: current.studentId }, select: { userId: true } });
    if (student?.userId) await notify({
      userId: student.userId, kind: "paid",
      title: `Оплата получена: ${new Intl.NumberFormat("ru-RU").format(current.amount)} ₽. Спасибо!`,
      link: "/student/payments?tab=bills",
    }, tx);
    return true;
  });
}

/** Отменить приём оплаты (кнопка «Отменить» у автоприёма): счёт снова ждёт проверки. */
export async function undoAccept(inv: Invoice, options: { auto?: boolean } = {}) {
  return db.$transaction(async (tx) => {
    if (!await lockStudentBilling(tx, inv.studentId)) return "stale";
    const current = await tx.invoice.findFirst({
      where: {
        id: inv.id, studentId: inv.studentId, status: "PAID", revision: inv.revision,
      },
    });
    if (!current || options.auto && (!current.autoAccepted || current.closedAt)) return "stale";

    const pack = await tx.pack.findUnique({ where: { invoiceId: inv.id } });
    if (pack && (pack.used || pack.lessonsLeft !== pack.lessonsTotal)) return "used";
    if (pack) await tx.pack.delete({ where: { id: pack.id } });
    await tx.invoice.update({
      where: { id: inv.id },
      data: { status: current.proofAt ? "PROOF_SENT" : "SENT", paidAt: null, autoAccepted: false, closedAt: null, revision: { increment: 1 } },
    });
    return "ok";
  });
}

/** Ученик прислал подтверждение. Текст или скриншот (сумму читает ИИ-распознавание): совпала сумма — автоприём, иначе — на проверку учителю. */
export async function submitProof(id: string, actor: Pick<User, "id" | "role">, proof: { text?: string; file?: string }) {
  const inv = await invoiceForDocumentWrite(id, "proof", actor);
  if (!inv || inv.status === "CANCELLED") return { ok: false, error: "not found" } as const;
  const text = proof.text?.trim().slice(0, 1000) || null;
  const upload = proof.file ? await paymentUploadForWrite(proof.file, id, "proof", actor.id) : null;
  if (proof.file && !upload) return { ok: false, error: "file" } as const;
  if (upload && fileUrl(upload.path) === inv.proofFile && text === inv.proofText &&
      (inv.status === "PROOF_SENT" || inv.status === "PAID")) return { ok: true, auto: inv.autoAccepted } as const;
  if (inv.status === "PAID") return { ok: false, error: "not found" } as const;
  if (upload && upload.paymentRevision !== inv.revision) return { ok: false, error: "stale" } as const;
  const content = upload ? await readPaymentDocument(upload) : null;
  if (upload && !content) return { ok: false, error: "file" } as const;

  const writable = {
    id,
    ...invoiceDocumentAccess(actor),
    studentId: inv.studentId,
    status: inv.status,
    revision: inv.revision,
  };
  let read: { source: "text" | "screenshot"; matches: boolean; code?: "EMPTY" | "FAILED" };
  if (text) {
    const found = amountsIn(text);
    read = { source: "text", matches: found.includes(inv.amount) };
  } else {
    if (!content) return { ok: false, error: "file" } as const;
    const current = await db.invoice.findFirst({ where: writable, select: { student: { select: { teacherId: true } } } });
    if (!current) return { ok: false, error: "not found" } as const;
    read = { source: "screenshot", matches: false };
    try {
      const seen = await ocr(content.buf, content.mime, { userId: actor.id, teacherId: current.student.teacherId }, { confidential: true });
      read = { source: "screenshot", matches: amountsIn(seen).includes(inv.amount), ...(seen.trim() ? {} : { code: "EMPTY" as const }) };
    } catch { read.code = "FAILED"; }
  }

  const matches = read.matches;
  const fresh = await db.$transaction(async (tx) => {
    if (!await lockStudentBilling(tx, inv.studentId)) return null;
    const change = await tx.invoice.updateMany({
      where: writable,
      data: {
        status: "PROOF_SENT", proofKind: upload ? "screenshot" : "text",
        proofFile: upload ? fileUrl(upload.path) : null, proofText: text, proofAt: new Date(), aiRead: read,
        revision: { increment: 1 },
      },
    });
    if (!change.count) return null;
    if (matches) await acceptInvoiceInTransaction(tx, inv, true);
    const student = await tx.student.findUniqueOrThrow({ where: { id: inv.studentId }, select: { teacherId: true, name: true } });
    await notify({
      userId: student.teacherId, kind: "payment",
      title: `${student.name} ${matches ? "оплатил(а)" : "прислал(а) подтверждение оплаты"}: ${new Intl.NumberFormat("ru-RU").format(inv.amount)} ₽`,
      action: matches ? "review" : "check_screenshot", link: "/teacher/finance?tab=check",
    }, tx);
    return true;
  });
  if (!fresh) return { ok: false, error: "not found" } as const;
  return { ok: true, auto: matches } as const;
}

// ───────── Плановые задачи (раз в минуту) ─────────

/** Списание уроков из абонемента: проведённые и оплачиваемые пропуски. */
async function deductPacks() {
  const eligible = {
    deductedAt: null, billedAt: null, isTrial: false, student: { payType: "PACK" }, charged: true,
    status: { in: ["DONE", "MISSED"] },
  } satisfies Prisma.LessonInstanceWhereInput;
  const lessons = await db.lessonInstance.findMany({ where: eligible, orderBy: { startsAt: "asc" }, take: 500 });
  for (const lesson of lessons) {
    const studentId = lesson.studentId;
    if (!studentId) continue;
    await db.$transaction(async (tx) => {
      if (!await lockStudentBilling(tx, studentId)) return;
      const current = await tx.lessonInstance.findFirst({ where: { id: lesson.id, studentId, ...eligible } });
      if (!current) return;
      const pack = await tx.pack.findFirst({
        where: { studentId, lessonsLeft: { gt: 0 }, OR: [{ frozenUntil: null }, { frozenUntil: { lt: current.startsAt } }] },
        orderBy: [{ startsAt: "asc" }, { id: "asc" }],
      });
      if (pack) await spendPackLesson(tx, pack, current.id);
    });
  }
}

/** Счета за новый абонемент: когда осталось 1 или 2 урока или абонемент закончился. */
async function billPacks() {
  // правило не сохранено — действует то, что показано в анкете по умолчанию: счёт, когда остался 1 урок
  const students = await db.student.findMany({ where: { payType: "PACK", status: "ACTIVE", OR: [{ billRule: { in: ["pack_left_1", "pack_left_2", "pack_end"] } }, { billRule: null }, { billRule: "" }] }, include: { packs: { orderBy: { startsAt: "desc" } } } });
  for (const s of students) {
    const left = s.packs.reduce((a, p) => a + p.lessonsLeft, 0);
    const rule = s.billRule || "pack_left_1";
    const threshold = rule === "pack_left_2" ? 2 : rule === "pack_left_1" ? 1 : 0;
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
  // правило не сохранено — действует то, что показано в анкете по умолчанию: счёт через 15 минут после урока
  // (для таких учеников — только уроки последней недели, чтобы не выставить разом старые)
  const students = await db.student.findMany({ where: { payType: "POSTPAID", status: "ACTIVE", OR: [{ billRule: { in: [...Object.keys(RULE_DELAY_MIN), "every_4_weeks"] } }, { billRule: null }, { billRule: "" }] } });
  for (const s of students) {
    const rule = s.billRule || "after_15";
    let unbilled = await db.lessonInstance.findMany({
      // «Оплатит позже» и уроки с отменённой оплатой учитель ведёт сам — счёт за них не выставляем
      where: { studentId: s.id, billedAt: null, noBill: false, payLaterAt: null, NOT: { isTrial: true, OR: [{ price: null }, { price: { lte: 0 } }] }, // платный пробный — в счёт; бесплатный — нет
       OR: [{ status: "DONE" }, { status: "MISSED", charged: true }] },
      orderBy: { startsAt: "asc" },
      include: { group: { select: { title: true } } },
    });
    if (!s.billRule) unbilled = unbilled.filter((l) => l.startsAt.getTime() > now.getTime() - 7 * 864e5);
    if (!unbilled.length) continue;
    let due = unbilled;
    if (rule === "every_4_weeks") {
      const first = await db.lessonInstance.findFirst({ where: { studentId: s.id, isTrial: false, OR: [{ status: "DONE" }, { status: "MISSED", charged: true }] }, orderBy: { startsAt: "asc" } });
      if (!first) continue;
      const periods = Math.floor((now.getTime() - first.startsAt.getTime()) / (28 * 864e5));
      if (periods < 1) continue;
      const boundary = new Date(first.startsAt.getTime() + periods * 28 * 864e5);
      due = unbilled.filter((l) => l.startsAt < boundary);
    } else {
      const delay = RULE_DELAY_MIN[rule] * 60000;
      due = unbilled.filter((l) => l.startsAt.getTime() + l.durationMin * 60000 + delay <= now.getTime());
    }
    if (!due.length) continue;
    const amount = due.reduce((a, l) => a + (l.price ?? s.price ?? 0), 0);
    if (amount <= 0) continue;
    const fmt = (d: Date) => d.toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: s.timezone });
    await createInvoice(s, {
      amount, kind: "lessons", lessonIds: due.map((l) => l.id),
      title: due.length === 1 ? (due[0].group ? `Групповое занятие «${due[0].group.title}», ${fmt(due[0].startsAt)}` : `Урок ${fmt(due[0].startsAt)}`) : `Уроки: ${due.length}`,
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
/** Разово для каждого учителя: неоплаченные уроки и счета получают цену из анкеты (раньше менялись только будущие уроки). */
async function repriceOnce() {
  const profs = await db.teacherProfile.findMany({ select: { userId: true, settings: true } });
  for (const p of profs) {
    const st = (p.settings ?? {}) as Record<string, unknown>;
    if (st.repricedV2) continue; // V2: и уроки, списанные из абонемента
    const students = await db.student.findMany({ where: { teacherId: p.userId, status: { in: ["ACTIVE", "INVITED"] } }, select: { id: true } });
    for (const s of students) await repriceLessons(s.id);
    await db.teacherProfile.update({ where: { userId: p.userId }, data: { settings: { ...st, repricedV1: true, repricedV2: true } } });
  }
}

export async function runBilling(now = new Date()) {
  if (running) return;
  running = true;
  try {
    // прошедшие запланированные уроки — проведены (то же, что при открытии расписания, но для всех учителей)
    await db.$executeRaw`UPDATE "LessonInstance" SET status = 'DONE' WHERE status = 'PLANNED' AND "startsAt" + ("durationMin" * interval '1 minute') < (now() at time zone 'UTC')`;
    await repriceOnce();
    await deductPacks();
    await billPacks();
    await billPostpaid(now);
    await remind(now);
    await weeklyReports(now);
    await weeklyMoments(now).catch((e) => console.error("[moments]", e)); // воскресенье 22:00 — события учеников на неделю
    await backfillTelegram().catch((e) => console.error("[tg-username]", e));
  } catch (e) {
    console.error("[billing]", e);
  } finally {
    running = false;
  }
}
