import "server-only";
import { db } from "../db";
import { earnedOf } from "../teacher/data";
import { addDaysIso, dayStart, isoDay, mondayOf } from "../time";

export type Range = "week" | "month" | "all";

export async function financeData(teacherId: string, tz: string, range: Range) {
  const now = new Date();
  const today = isoDay(now, tz);
  const [y, m] = today.split("-").map(Number);
  const from = range === "week" ? dayStart(mondayOf(today), tz) : range === "month" ? dayStart(`${y}-${String(m).padStart(2, "0")}-01`, tz) : new Date(0);
  const six = dayStart(`${m > 5 ? y : y - 1}-${String(((m - 6 + 12) % 12) + 1).padStart(2, "0")}-01`, tz);

  const [lessons, invoices, students] = await Promise.all([
    db.lessonInstance.findMany({ where: { teacherId, startsAt: { gte: range === "all" ? new Date(0) : six < from ? six : from, lte: now } }, select: { status: true, charged: true, isTrial: true, price: true, startsAt: true, movedFrom: true, studentId: true } }),
    db.invoice.findMany({ where: { student: { teacherId } }, include: { student: true }, orderBy: { createdAt: "desc" } }),
    db.student.findMany({ where: { teacherId, status: "ACTIVE" }, include: { packs: { where: { lessonsLeft: { gt: 0 } } } }, orderBy: { name: "asc" } }),
  ]);

  const inRange = lessons.filter((l) => l.startsAt >= from && !l.isTrial);
  const earned = inRange.reduce((a, l) => a + earnedOf(l), 0);
  const received = invoices.filter((i) => i.status === "PAID" && i.paidAt && i.paidAt >= from).reduce((a, i) => a + i.amount, 0);
  const waiting = invoices.filter((i) => i.status === "SENT" || i.status === "PROOF_SENT").reduce((a, i) => a + i.amount, 0);
  const prepaid = students.reduce((a, s) => a + s.packs.reduce((b, p) => b + Math.round((p.price / Math.max(1, p.lessonsTotal)) * p.lessonsLeft), 0), 0);
  const total = inRange.length;
  const cancelled = inRange.filter((l) => l.status === "CANCELLED").length;
  const moved = inRange.filter((l) => l.movedFrom).length;

  // по месяцам: последние 6
  const months = Array.from({ length: 6 }, (_, i) => {
    const mm = ((m - 6 + i + 12) % 12) + 1, yy = m - 6 + i < 0 ? y - 1 : y;
    const key = `${yy}-${String(mm).padStart(2, "0")}`;
    const start = dayStart(`${key}-01`, tz), end = dayStart(addDaysIso(`${mm === 12 ? yy + 1 : yy}-${String((mm % 12) + 1).padStart(2, "0")}-01`, 0), tz);
    return {
      key, start,
      earned: lessons.filter((l) => l.startsAt >= start && l.startsAt < end).reduce((a, l) => a + earnedOf(l), 0),
      received: invoices.filter((x) => x.status === "PAID" && x.paidAt && x.paidAt >= start && x.paidAt < end).reduce((a, x) => a + x.amount, 0),
    };
  });

  const perStudent = students.map((s) => {
    const ls = inRange.filter((l) => l.studentId === s.id);
    return {
      s, earned: ls.reduce((a, l) => a + earnedOf(l), 0), lessons: ls.filter((l) => earnedOf(l) > 0).length,
      cancelRate: ls.length ? ls.filter((l) => l.status === "CANCELLED").length / ls.length : 0,
      moveRate: ls.length ? ls.filter((l) => l.movedFrom).length / ls.length : 0,
      debt: invoices.filter((i) => i.studentId === s.id && (i.status === "SENT" || i.status === "PROOF_SENT")).reduce((a, i) => a + i.amount, 0),
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

  return { earned, received, waiting, prepaid, total, cancelled, moved, months, perStudent, check, oldestProof, insights };
}
