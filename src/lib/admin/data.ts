import "server-only";
import { db } from "../db";
import { accessOf, type AccessState } from "./features";

const DAY = 864e5;

export type TeacherRow = {
  id: string; name: string; email: string; createdAt: Date; lastSeenAt: Date | null; source: string | null;
  state: AccessState; until: Date | null; plan: { id: string; name: string; priceMonth: number } | null;
  students: number; lessons30: number; paidTotal: number; activated: boolean;
};

/** Все учителя платформы с доступом, тарифом и активностью (уроки за 30 дней, ученики, сколько заплатили). */
export async function teacherRows(now = new Date()): Promise<TeacherRow[]> {
  const since = new Date(now.getTime() - 30 * DAY);
  const [profiles, lessons, everDone, pays] = await Promise.all([
    db.teacherProfile.findMany({
      include: { user: { select: { name: true, lastName: true, email: true, createdAt: true, lastSeenAt: true } }, plan: { select: { id: true, name: true, priceMonth: true } }, _count: { select: { students: { where: { status: { not: "ARCHIVED" } } } } } },
    }),
    db.lessonInstance.groupBy({ by: ["teacherId"], where: { status: "DONE", startsAt: { gte: since } }, _count: { _all: true } }),
    db.lessonInstance.groupBy({ by: ["teacherId"], where: { status: "DONE" }, _count: { _all: true } }),
    db.teacherPayment.groupBy({ by: ["teacherId"], _sum: { amount: true } }),
  ]);
  const l30 = new Map(lessons.map((x) => [x.teacherId, x._count._all]));
  const done = new Set(everDone.map((x) => x.teacherId));
  const paid = new Map(pays.map((x) => [x.teacherId, x._sum.amount ?? 0]));
  return profiles.map((p) => {
    const a = accessOf(p, now);
    return {
      id: p.userId, name: [p.user.name, p.user.lastName].filter(Boolean).join(" "), email: p.user.email, createdAt: p.user.createdAt, lastSeenAt: p.user.lastSeenAt,
      source: p.source, state: a.state, until: a.until, plan: p.plan, students: p._count.students, lessons30: l30.get(p.userId) ?? 0,
      paidTotal: paid.get(p.userId) ?? 0, activated: p._count.students > 0 && done.has(p.userId),
    };
  }).sort((a, b) => +b.createdAt - +a.createdAt);
}

/** Месячный доход по подписке (MRR): у оплативших — цена тарифа в месяц (или последний платёж / месяцы). */
export async function mrrOf(rows: TeacherRow[]) {
  const paidIds = rows.filter((r) => r.state === "paid").map((r) => r.id);
  if (!paidIds.length) return 0;
  const last = await db.teacherPayment.findMany({ where: { teacherId: { in: paidIds } }, orderBy: { paidAt: "desc" }, distinct: ["teacherId"] });
  const byT = new Map(last.map((p) => [p.teacherId, p.amount / Math.max(1, p.months)]));
  return rows.filter((r) => r.state === "paid").reduce((s, r) => s + (r.plan?.priceMonth ?? byT.get(r.id) ?? 0), 0);
}

export type FeedItem = { at: Date; kind: "signup" | "payment" | "trialSoon" | "trialEnded" | "inactive" | "firstLesson" | "firstStudent"; teacherId: string; name: string; amount?: number; days?: number };

/** «Что нового» у администратора: регистрации, оплаты, конец пробного, первые шаги учителей и риск оттока. */
export async function adminFeed(rows: TeacherRow[], now = new Date()): Promise<FeedItem[]> {
  const since = new Date(now.getTime() - 30 * DAY);
  const name = new Map(rows.map((r) => [r.id, r.name]));
  const [pays, firstLesson, firstStudent, profiles] = await Promise.all([
    db.teacherPayment.findMany({ where: { paidAt: { gte: since } }, orderBy: { paidAt: "desc" }, take: 50 }),
    db.lessonInstance.groupBy({ by: ["teacherId"], where: { status: "DONE" }, _min: { startsAt: true } }),
    db.student.groupBy({ by: ["teacherId"], _min: { createdAt: true } }),
    db.teacherProfile.findMany({ select: { userId: true, trialUntil: true, paidUntil: true, blockedAt: true } }),
  ]);
  const out: FeedItem[] = [];
  for (const r of rows) {
    if (r.createdAt >= since) out.push({ at: r.createdAt, kind: "signup", teacherId: r.id, name: r.name });
    if ((r.state === "trial" || r.state === "paid") && (!r.lastSeenAt || r.lastSeenAt < new Date(now.getTime() - 7 * DAY)))
      out.push({ at: r.lastSeenAt ?? r.createdAt, kind: "inactive", teacherId: r.id, name: r.name, days: Math.floor((now.getTime() - +(r.lastSeenAt ?? r.createdAt)) / DAY) });
  }
  for (const p of profiles) {
    if (p.blockedAt || (p.paidUntil && p.paidUntil > now) || !p.trialUntil) continue;
    const d = (p.trialUntil.getTime() - now.getTime()) / DAY;
    if (d > 0 && d <= 3) out.push({ at: now, kind: "trialSoon", teacherId: p.userId, name: name.get(p.userId) ?? "", days: Math.ceil(d) });
    if (d <= 0 && d > -14) out.push({ at: p.trialUntil, kind: "trialEnded", teacherId: p.userId, name: name.get(p.userId) ?? "" });
  }
  for (const p of pays) out.push({ at: p.paidAt, kind: "payment", teacherId: p.teacherId, name: name.get(p.teacherId) ?? "", amount: p.amount });
  for (const x of firstLesson) if (x.teacherId && x._min.startsAt && x._min.startsAt >= since && x._min.startsAt <= now) out.push({ at: x._min.startsAt, kind: "firstLesson", teacherId: x.teacherId, name: name.get(x.teacherId) ?? "" });
  for (const x of firstStudent) if (x._min.createdAt && x._min.createdAt >= since) out.push({ at: x._min.createdAt, kind: "firstStudent", teacherId: x.teacherId, name: name.get(x.teacherId) ?? "" });
  // сначала то, что требует действия: конец пробного, затем по времени
  const prio = (k: FeedItem["kind"]) => (k === "trialSoon" ? 0 : 1);
  return out.filter((x) => x.name).sort((a, b) => prio(a.kind) - prio(b.kind) || +b.at - +a.at).slice(0, 40);
}

/** Выручка по месяцам за последние 12 месяцев. */
export async function revenueByMonth(now = new Date()) {
  const from = new Date(now.getFullYear(), now.getMonth() - 11, 1);
  const pays = await db.teacherPayment.findMany({ where: { paidAt: { gte: from } }, select: { paidAt: true, amount: true } });
  const months = Array.from({ length: 12 }, (_, i) => { const d = new Date(from.getFullYear(), from.getMonth() + i, 1); return { key: `${d.getFullYear()}-${d.getMonth()}`, d, sum: 0 }; });
  const idx = new Map(months.map((m, i) => [m.key, i]));
  for (const p of pays) { const i = idx.get(`${p.paidAt.getFullYear()}-${p.paidAt.getMonth()}`); if (i !== undefined) months[i].sum += p.amount; }
  return months;
}
