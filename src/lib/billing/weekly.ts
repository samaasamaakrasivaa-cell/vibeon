import "server-only";
import { db } from "../db";
import { earnedOf, rub } from "../teacher/data";
import { addDaysIso, dayStart, isoDay, mondayOf } from "../time";
import { notify } from "../notify";

/** Итоги прошлой недели (пн–вс) для учителя: деньги, уроки, отмены, кто должен — и сравнение с неделей до неё. */
export async function weekReport(teacherId: string, tz: string, now = new Date()) {
  const thisMon = mondayOf(isoDay(now, tz));
  const mon = addDaysIso(thisMon, -7), prevMon = addDaysIso(thisMon, -14);
  const [from, to, pFrom] = [dayStart(mon, tz), dayStart(thisMon, tz), dayStart(prevMon, tz)];
  const [lessons, paid, open, unbilled] = await Promise.all([
    db.lessonInstance.findMany({ where: { teacherId, startsAt: { gte: pFrom, lt: to } }, select: { startsAt: true, status: true, charged: true, isTrial: true, price: true, movedFrom: true, groupId: true, slotId: true } }),
    db.invoice.findMany({ where: { student: { teacherId }, status: "PAID", paidAt: { gte: pFrom, lt: to } }, select: { amount: true, paidAt: true } }),
    db.invoice.findMany({ where: { student: { teacherId, status: "ACTIVE" }, status: { in: ["SENT", "PROOF_SENT"] } }, select: { amount: true, student: { select: { id: true, name: true, lastName: true } } } }),
    db.lessonInstance.findMany({ where: { teacherId, billedAt: null, deductedAt: null, payLaterAt: null, startsAt: { lt: now }, studentId: { not: null }, student: { status: "ACTIVE" }, OR: [{ status: "DONE" }, { status: "MISSED", charged: true }] }, select: { price: true, isTrial: true, student: { select: { id: true, name: true, lastName: true, price: true } } } }),
  ]);
  const inWeek = (d: Date, a: Date, b: Date) => d >= a && d < b;
  const stat = (a: Date, b: Date) => {
    const ls = lessons.filter((l) => inWeek(l.startsAt, a, b));
    // групповое занятие считаем одним уроком
    const seen = new Set<string>();
    const units = ls.filter((l) => { if (!(l.groupId && l.slotId)) return true; if (seen.has(l.slotId)) return false; seen.add(l.slotId); return true; });
    return {
      earned: ls.reduce((s, l) => s + earnedOf(l), 0),
      received: paid.filter((p) => p.paidAt && inWeek(p.paidAt, a, b)).reduce((s, p) => s + p.amount, 0),
      done: units.filter((l) => l.status === "DONE").length,
      cancelled: units.filter((l) => l.status === "CANCELLED").length,
      moved: units.filter((l) => l.movedFrom).length,
    };
  };
  const cur = stat(from, to), prev = stat(pFrom, from);
  // кто должен сейчас: выставленные счета + проведённые уроки без счёта
  const debt = new Map<string, { id: string; name: string; sum: number }>();
  const add = (s: { id: string; name: string; lastName: string | null }, n: number) => { if (n <= 0) return; const x = debt.get(s.id) ?? { id: s.id, name: [s.name, s.lastName].filter(Boolean).join(" "), sum: 0 }; x.sum += n; debt.set(s.id, x); };
  for (const i of open) add(i.student, i.amount);
  for (const l of unbilled) if (l.student && (!l.isTrial || (l.price ?? 0) > 0)) add(l.student, l.price ?? l.student.price ?? 0);
  const debtors = [...debt.values()].sort((a, b) => b.sum - a.sum);
  return { mon, sun: addDaysIso(thisMon, -1), cur, prev, waiting: debtors.reduce((s, d) => s + d.sum, 0), debtors: debtors.slice(0, 3) };
}

export type WeekReport = Awaited<ReturnType<typeof weekReport>>;

const fmtRange = (mon: string, sun: string) => {
  const d = (s: string, o: Intl.DateTimeFormatOptions) => new Date(`${s}T12:00:00Z`).toLocaleDateString("ru-RU", { ...o, timeZone: "UTC" });
  return mon.slice(5, 7) === sun.slice(5, 7) ? `${d(mon, { day: "numeric" })}–${d(sun, { day: "numeric", month: "long" })}` : `${d(mon, { day: "numeric", month: "long" })} – ${d(sun, { day: "numeric", month: "long" })}`;
};

/** Понедельник, 9:00 по времени учителя (и до конца дня): уведомление с итогами прошлой недели — один раз. */
export async function weeklyFinanceReports(now = new Date()) {
  const teachers = await db.user.findMany({ where: { role: "TEACHER", teacherProfile: { blockedAt: null } }, select: { id: true, timezone: true } });
  for (const u of teachers) {
    const local = new Date(now.toLocaleString("en-US", { timeZone: u.timezone }));
    if (local.getDay() !== 1 || local.getHours() < 9) continue;
    const mon = addDaysIso(mondayOf(isoDay(now, u.timezone)), -7);
    if (await db.notification.findUnique({ where: { dedupe: `finweek:${u.id}:${mon}` }, select: { id: true } })) continue; // уже отправлен
    const r = await weekReport(u.id, u.timezone, now);
    // учеников и уроков не было — отчёт не нужен
    if (!r.cur.done && !r.cur.received && !r.cur.earned && !r.waiting) continue;
    const parts = [`получено ${rub(r.cur.received)}`, `заработано ${rub(r.cur.earned)}`, `уроков ${r.cur.done}`];
    if (r.cur.cancelled) parts.push(`отмен ${r.cur.cancelled}`);
    if (r.waiting) parts.push(`ждём оплаты ${rub(r.waiting)}`);
    await notify({
      userId: u.id, kind: "report", link: "/teacher/finance?tab=updates#week",
      title: `Финансы за неделю ${fmtRange(r.mon, r.sun)}: ${parts.join(", ")}`,
      dedupe: `finweek:${u.id}:${r.mon}`,
    }).catch((e) => console.error("[finweek]", e));
  }
}
