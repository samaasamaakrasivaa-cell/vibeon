import "server-only";
import { db } from "../db";
import { earnedOf } from "../teacher/data";
import { addDaysIso, dayStart, isoDay, mondayOf } from "../time";

export type Range = "week" | "month" | "all";

export async function financeData(teacherId: string, tz: string, range: Range) {
  const now = new Date();
  const today = isoDay(now, tz);
  const [y, m] = today.split("-").map(Number);
  const monthKey = (yy: number, mm: number) => `${yy}-${String(mm).padStart(2, "0")}`;
  const nextMonth = (yy: number, mm: number) => (mm === 12 ? [yy + 1, 1] : [yy, mm + 1]);
  const from = range === "week" ? dayStart(mondayOf(today), tz) : range === "month" ? dayStart(`${monthKey(y, m)}-01`, tz) : new Date(0);
  // конец периода: неделя / месяц целиком (переносы и отмены на будущие дни этого периода тоже считаем)
  const periodEnd = range === "week" ? dayStart(addDaysIso(mondayOf(today), 7), tz) : range === "month" ? dayStart(`${monthKey(...(nextMonth(y, m) as [number, number]))}-01`, tz) : new Date(now.getTime() + 366 * 864e5);
  const twelve = dayStart(`${monthKey(m === 12 ? y : y - 1, (m % 12) + 1)}-01`, tz); // 12 месяцев назад — для графика «всё время»

  const [lessons, invoices, students, unbilledRaw] = await Promise.all([
    db.lessonInstance.findMany({ where: { teacherId, OR: [{ startsAt: { gte: range === "all" ? new Date(0) : from < twelve ? from : twelve, lt: periodEnd } }, { movedFrom: { gte: from, lt: periodEnd } }] }, select: { status: true, charged: true, isTrial: true, price: true, startsAt: true, movedFrom: true, studentId: true } }),
    db.invoice.findMany({ where: { student: { teacherId } }, include: { student: true }, orderBy: { createdAt: "desc" } }),
    db.student.findMany({ where: { teacherId, status: "ACTIVE" }, include: { packs: { where: { lessonsLeft: { gt: 0 } } } }, orderBy: { name: "asc" } }),
    // проведённые уроки без счёта и без списания из абонемента — тоже долг ученика («Ждём оплаты»), пока учитель не отметит «Оплачено»
    db.lessonInstance.findMany({
      where: { teacherId, billedAt: null, deductedAt: null, startsAt: { lte: now }, studentId: { not: null }, student: { status: "ACTIVE" }, OR: [{ status: "DONE" }, { status: "MISSED", charged: true }] },
      include: { student: { select: { id: true, name: true, lastName: true, price: true } } }, orderBy: { startsAt: "desc" }, take: 300,
    }),
  ]);
  const unbilled = unbilledRaw.filter((l) => !l.isTrial || (l.price ?? 0) > 0).map((l) => ({ id: l.id, startsAt: l.startsAt, student: l.student!, amount: l.price ?? l.student!.price ?? 0 })).filter((l) => l.amount > 0);
  const unbilledSum = unbilled.reduce((a, l) => a + l.amount, 0);

  const paidOk = (l: (typeof lessons)[number]) => !l.isTrial || (l.price ?? 0) > 0; // платный пробный — в финансах
  const inRange = lessons.filter((l) => l.startsAt >= from && l.startsAt <= now && paidOk(l)); // заработано — только прошедшие
  // уроки периода целиком — для отмен и переносов (перенос считаем по дате, с которой перенесли)
  const inPeriod = lessons.filter((l) => paidOk(l) && ((l.startsAt >= from && l.startsAt < periodEnd) || (l.movedFrom && l.movedFrom >= from && l.movedFrom < periodEnd)));
  const earned = inRange.reduce((a, l) => a + earnedOf(l), 0);
  const received = invoices.filter((i) => i.status === "PAID" && i.paidAt && i.paidAt >= from).reduce((a, i) => a + i.amount, 0);
  const waiting = invoices.filter((i) => i.status === "SENT" || i.status === "PROOF_SENT").reduce((a, i) => a + i.amount, 0) + unbilledSum;
  const prepaid = students.reduce((a, s) => a + s.packs.reduce((b, p) => b + Math.round((p.price / Math.max(1, p.lessonsTotal)) * p.lessonsLeft), 0), 0);
  const total = inPeriod.length;
  const cancelled = inPeriod.filter((l) => l.status === "CANCELLED").length;
  const moved = inPeriod.filter((l) => l.movedFrom).length;

  // график доходов — по выбранному периоду: неделя — по дням, месяц — по неделям, всё время — по месяцам (12)
  type Bucket = { key: string; start: Date; end: Date; kind: "day" | "week" | "month" };
  const buckets: Bucket[] = range === "week"
    ? Array.from({ length: 7 }, (_, i) => { const iso = addDaysIso(mondayOf(today), i); return { key: iso, start: dayStart(iso, tz), end: dayStart(addDaysIso(iso, 1), tz), kind: "day" as const }; })
    : range === "month"
      ? (() => {
          const first = `${monthKey(y, m)}-01`, out: Bucket[] = [];
          for (let s = first; s < isoDay(periodEnd, tz) || out.length === 0; ) {
            const e = addDaysIso(mondayOf(s), 7) < isoDay(periodEnd, tz) ? addDaysIso(mondayOf(s), 7) : isoDay(periodEnd, tz);
            out.push({ key: s, start: dayStart(s, tz), end: dayStart(e, tz), kind: "week" });
            if (e <= s) break;
            s = e;
          }
          return out;
        })()
      : Array.from({ length: 12 }, (_, i) => {
          let yy = y, mm = m - 11 + i;
          while (mm < 1) { mm += 12; yy -= 1; }
          const [ny, nm] = nextMonth(yy, mm);
          return { key: monthKey(yy, mm), start: dayStart(`${monthKey(yy, mm)}-01`, tz), end: dayStart(`${monthKey(ny, nm)}-01`, tz), kind: "month" as const };
        });
  const months = buckets.map((b) => ({
    ...b,
    endIso: addDaysIso(isoDay(b.end, tz), -1),
    earned: lessons.filter((l) => l.startsAt >= b.start && l.startsAt < b.end && l.startsAt <= now && paidOk(l)).reduce((a, l) => a + earnedOf(l), 0),
    received: invoices.filter((x) => x.status === "PAID" && x.paidAt && x.paidAt >= b.start && x.paidAt < b.end).reduce((a, x) => a + x.amount, 0),
  }));

  const perStudent = students.map((s) => {
    const ls = inRange.filter((l) => l.studentId === s.id);
    const lp = inPeriod.filter((l) => l.studentId === s.id);
    return {
      s, earned: ls.reduce((a, l) => a + earnedOf(l), 0), lessons: ls.filter((l) => earnedOf(l) > 0).length,
      cancelRate: lp.length ? lp.filter((l) => l.status === "CANCELLED").length / lp.length : 0,
      moveRate: lp.length ? lp.filter((l) => l.movedFrom).length / lp.length : 0,
      debt: invoices.filter((i) => i.studentId === s.id && (i.status === "SENT" || i.status === "PROOF_SENT")).reduce((a, i) => a + i.amount, 0) + unbilled.filter((l) => l.student.id === s.id).reduce((a, l) => a + l.amount, 0),
      left: s.payType === "PACK" ? s.packs.reduce((a, p) => a + p.lessonsLeft, 0) : null,
    };
  }).sort((a, b) => b.earned - a.earned);

  const check = {
    waiting: invoices.filter((i) => i.status === "SENT"),
    toCheck: invoices.filter((i) => i.status === "PROOF_SENT"),
    auto: invoices.filter((i) => i.status === "PAID" && i.autoAccepted && !i.closedAt),
  };
  const oldestProof = check.toCheck.reduce<Date | null>((mn, i) => (!mn || (i.proofAt && i.proofAt < mn) ? i.proofAt : mn), null);

  // «Стоит взглянуть»
  const avgCancel = total ? cancelled / total : 0, avgMove = total ? moved / total : 0;
  const insights: { kind: string; vars: Record<string, string | number> }[] = [];
  const byCancel = perStudent.filter((p) => p.cancelRate > Math.max(0.15, avgCancel * 2)).sort((a, b) => b.cancelRate - a.cancelRate)[0];
  if (byCancel) insights.push({ kind: "cancels", vars: { name: `${byCancel.s.name} ${byCancel.s.lastName ?? ""}`.trim(), p: Math.round(byCancel.cancelRate * 100), avg: Math.round(avgCancel * 100) } });
  const byMove = perStudent.filter((p) => p.moveRate > Math.max(0.15, avgMove * 2)).sort((a, b) => b.moveRate - a.moveRate)[0];
  if (byMove) insights.push({ kind: "moves", vars: { name: `${byMove.s.name} ${byMove.s.lastName ?? ""}`.trim(), p: Math.round(byMove.moveRate * 100), avg: Math.round(avgMove * 100) } });
  const debt = [...perStudent].sort((a, b) => b.debt - a.debt)[0];
  if (debt?.debt) insights.push({ kind: "debt", vars: { name: `${debt.s.name} ${debt.s.lastName ?? ""}`.trim(), sum: debt.debt } });
  const ending = perStudent.filter((p) => p.left !== null && p.left <= 1).map((p) => p.s.name);
  if (ending.length) insights.push({ kind: "ending", vars: { names: ending.join(", ") } });

  return { unbilled, unbilledSum, earned, received, waiting, prepaid, total, cancelled, moved, months, perStudent, check, oldestProof, insights };
}
