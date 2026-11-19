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
    db.lessonInstance.findMany({ where: { teacherId, OR: [{ startsAt: { gte: range === "all" ? new Date(0) : from < twelve ? from : twelve, lt: periodEnd } }, { movedFrom: { gte: from, lt: periodEnd } }] }, select: { id: true, status: true, charged: true, isTrial: true, price: true, startsAt: true, movedFrom: true, studentId: true, slotId: true, groupId: true, student: { select: { name: true, lastName: true } }, group: { select: { title: true } } } }),
    db.invoice.findMany({ where: { student: { teacherId } }, include: { student: true }, orderBy: { createdAt: "desc" } }),
    db.student.findMany({ where: { teacherId, status: "ACTIVE" }, include: { packs: { where: { lessonsLeft: { gt: 0 } } } }, orderBy: { name: "asc" } }),
    // проведённые уроки без счёта и без списания из абонемента — тоже долг ученика («Ждём оплаты»), пока учитель не отметит «Оплачено»
    db.lessonInstance.findMany({
      where: { teacherId, billedAt: null, deductedAt: null, startsAt: { lte: now }, studentId: { not: null }, student: { status: "ACTIVE" }, OR: [{ status: "DONE" }, { status: "MISSED", charged: true }] },
      include: { student: { select: { id: true, name: true, lastName: true, price: true, avatar: true } } }, orderBy: { startsAt: "desc" }, take: 300,
    }),
  ]);
  const owed = unbilledRaw.filter((l) => !l.isTrial || (l.price ?? 0) > 0).map((l) => ({ id: l.id, startsAt: l.startsAt, student: l.student!, amount: l.price ?? l.student!.price ?? 0, later: l.payLaterAt })).filter((l) => l.amount > 0);
  // «Оплатит позже» — отдельным списком: не висят в «без счёта», но долг остаётся
  const unbilled = owed.filter((l) => !l.later), later = owed.filter((l) => l.later);
  const unbilledSum = owed.reduce((a, l) => a + l.amount, 0);
  const laterSum = later.reduce((a, l) => a + l.amount, 0);

  const paidOk = (l: (typeof lessons)[number]) => !l.isTrial || (l.price ?? 0) > 0; // платный пробный — в финансах
  const inRange = lessons.filter((l) => l.startsAt >= from && l.startsAt <= now && paidOk(l)); // заработано — только прошедшие
  // уроки периода целиком — для отмен и переносов (перенос считаем по дате, с которой перенесли)
  const inPeriod = lessons.filter((l) => paidOk(l) && ((l.startsAt >= from && l.startsAt < periodEnd) || (l.movedFrom && l.movedFrom >= from && l.movedFrom < periodEnd)));
  const earned = inRange.reduce((a, l) => a + earnedOf(l), 0);
  const received = invoices.filter((i) => i.status === "PAID" && i.paidAt && i.paidAt >= from).reduce((a, i) => a + i.amount, 0);
  const waiting = invoices.filter((i) => i.status === "SENT" || i.status === "PROOF_SENT").reduce((a, i) => a + i.amount, 0) + unbilledSum;
  const prepaid = students.reduce((a, s) => a + s.packs.reduce((b, p) => b + Math.round((p.price / Math.max(1, p.lessonsTotal)) * p.lessonsLeft), 0), 0);
  // отмены и переносы: групповое занятие — одно (у каждого ученика группы свой урок, но переносила группа)
  const seen = new Set<string>();
  const pUnits = inPeriod.filter((l) => { if (!(l.groupId && l.slotId)) return true; if (seen.has(l.slotId)) return false; seen.add(l.slotId); return true; });
  const who = (l: (typeof lessons)[number]) => (l.groupId ? `«${l.group?.title ?? ""}»` : `${l.student?.name ?? ""} ${l.student?.lastName ?? ""}`.trim());
  const total = pUnits.length;
  const cancelledList = pUnits.filter((l) => l.status === "CANCELLED").map((l) => ({ id: l.id, who: who(l), group: !!l.groupId, at: l.startsAt, charged: l.charged })).sort((a, b) => a.at.getTime() - b.at.getTime());
  const movedList = pUnits.filter((l) => l.movedFrom).map((l) => ({ id: l.id, who: who(l), group: !!l.groupId, from: l.movedFrom!, to: l.startsAt, cancelled: l.status === "CANCELLED" })).sort((a, b) => a.from.getTime() - b.from.getTime());
  const cancelled = cancelledList.length;
  const moved = movedList.length;

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

  const openInv = invoices.filter((i) => i.status === "SENT" || i.status === "PROOF_SENT");
  // даты уроков в неоплаченных счетах — для расшифровки «за какие уроки долг»
  const invDates = new Map((await db.lessonInstance.findMany({ where: { id: { in: openInv.flatMap((i) => i.lessonIds) } }, select: { id: true, startsAt: true } })).map((l) => [l.id, l.startsAt]));
  const datesOf = (i: { lessonIds: string[] }) => i.lessonIds.map((id) => invDates.get(id)).filter((x): x is Date => !!x).sort((a, b) => a.getTime() - b.getTime());
  const perStudent = students.map((s) => {
    const ls = inRange.filter((l) => l.studentId === s.id);
    const lp = inPeriod.filter((l) => l.studentId === s.id);
    return {
      s, earned: ls.reduce((a, l) => a + earnedOf(l), 0), lessons: ls.filter((l) => earnedOf(l) > 0).length,
      cancelRate: lp.length ? lp.filter((l) => l.status === "CANCELLED").length / lp.length : 0,
      moveRate: lp.length ? lp.filter((l) => l.movedFrom).length / lp.length : 0,
      debtLessons: owed.filter((l) => l.student.id === s.id).map((l) => l.startsAt).sort((a, b) => a.getTime() - b.getTime()),
      debtInvoices: invoices.filter((i) => i.studentId === s.id && (i.status === "SENT" || i.status === "PROOF_SENT")).map((i) => ({ title: i.title ?? "", amount: i.amount, dates: datesOf(i) })),
      debt: invoices.filter((i) => i.studentId === s.id && (i.status === "SENT" || i.status === "PROOF_SENT")).reduce((a, i) => a + i.amount, 0) + owed.filter((l) => l.student.id === s.id).reduce((a, l) => a + l.amount, 0),
      left: s.payType === "PACK" ? s.packs.reduce((a, p) => a + p.lessonsLeft, 0) : null,
    };
  }).sort((a, b) => b.earned - a.earned);

  // расшифровка плиток: кто сколько
  const nm = (x: { name: string; lastName: string | null }) => `${x.name} ${x.lastName ?? ""}`.trim();
  const paidIn = invoices.filter((i) => i.status === "PAID" && i.paidAt && i.paidAt >= from);
  const group = <T,>(xs: T[], key: (x: T) => string) => { const m = new Map<string, T[]>(); for (const x of xs) m.set(key(x), [...(m.get(key(x)) ?? []), x]); return [...m.values()]; };
  const receivedBy = group(paidIn, (i) => i.studentId).map((xs) => ({ id: xs[0].studentId, name: nm(xs[0].student), avatar: xs[0].student.avatar, sum: xs.reduce((a, i) => a + i.amount, 0), n: xs.length, last: xs.reduce((m, i) => (i.paidAt! > m ? i.paidAt! : m), xs[0].paidAt!) })).sort((a, b) => b.sum - a.sum);
  const waitIds = [...new Set([...openInv.map((i) => i.studentId), ...owed.map((l) => l.student.id)])];
  const waitingBy = waitIds.map((id) => {
    const inv = openInv.filter((i) => i.studentId === id), ls = owed.filter((l) => l.student.id === id);
    const st = inv[0]?.student ?? ls[0].student;
    return { id, name: nm(st), avatar: st.avatar, sum: inv.reduce((a, i) => a + i.amount, 0) + ls.reduce((a, l) => a + l.amount, 0), lessons: ls.map((l) => l.startsAt).sort((a, b) => a.getTime() - b.getTime()), later: ls.some((l) => l.later), invoices: inv.map((i) => ({ title: i.title ?? "", amount: i.amount, proof: i.status === "PROOF_SENT", dates: datesOf(i) })) };
  }).sort((a, b) => b.sum - a.sum);
  const prepaidBy = students.filter((s) => s.packs.length).map((s) => ({ id: s.id, name: nm(s), avatar: s.avatar, sum: s.packs.reduce((b, p) => b + Math.round((p.price / Math.max(1, p.lessonsTotal)) * p.lessonsLeft), 0), left: s.packs.reduce((a, p) => a + p.lessonsLeft, 0), totalN: s.packs.reduce((a, p) => a + p.lessonsTotal, 0) })).filter((x) => x.sum > 0).sort((a, b) => b.sum - a.sum);

  const check = {
    waiting: invoices.filter((i) => i.status === "SENT"),
    toCheck: invoices.filter((i) => i.status === "PROOF_SENT"),
    auto: invoices.filter((i) => i.status === "PAID" && i.autoAccepted && !i.closedAt),
  };
  const oldestProof = check.toCheck.reduce<Date | null>((mn, i) => (!mn || (i.proofAt && i.proofAt < mn) ? i.proofAt : mn), null);

  // «Стоит взглянуть» — по последним 30 дням, а не по выбранному периоду: вывод по одному-двум урокам недели ничего не значит.
  // Групповое занятие считается один раз и за группу (переносит группа, а не один ученик); вывод — только если переносов
  // или отмен хотя бы 2, уроков хотя бы 4 и доля заметно выше средней.
  const since = new Date(now.getTime() - 30 * 864e5);
  const recent = await db.lessonInstance.findMany({
    where: { teacherId, studentId: { not: null }, OR: [{ startsAt: { gte: since, lte: now } }, { movedFrom: { gte: since, lte: now } }] },
    select: { slotId: true, groupId: true, studentId: true, status: true, movedFrom: true, isTrial: true, price: true, student: { select: { name: true, lastName: true, status: true } }, group: { select: { title: true } } },
  });
  type Unit = { name: string; total: number; moved: number; cancelled: number };
  const units = new Map<string, Unit>(); const seenSlot = new Set<string>();
  for (const l of recent) {
    if ((l.isTrial && !((l.price ?? 0) > 0)) || l.student?.status !== "ACTIVE") continue;
    if (l.groupId && l.slotId) { if (seenSlot.has(l.slotId)) continue; seenSlot.add(l.slotId); }
    const key = l.groupId ? `g:${l.groupId}` : `s:${l.studentId}`;
    const u = units.get(key) ?? { name: l.groupId ? `«${l.group?.title ?? ""}»` : `${l.student?.name ?? ""} ${l.student?.lastName ?? ""}`.trim(), total: 0, moved: 0, cancelled: 0 };
    u.total++; if (l.movedFrom) u.moved++; if (l.status === "CANCELLED") u.cancelled++;
    units.set(key, u);
  }
  const all = [...units.entries()];
  const sumT = all.reduce((a, [, u]) => a + u.total, 0);
  const avgOf = (k: "moved" | "cancelled") => (sumT ? all.reduce((a, [, u]) => a + u[k], 0) / sumT : 0);
  const insights: { kind: string; vars: Record<string, string | number> }[] = [];
  for (const [k, kind] of [["cancelled", "cancels"], ["moved", "moves"]] as const) {
    const avg = avgOf(k);
    const top = all.filter(([, u]) => u[k] >= 2 && u.total >= 4 && u[k] / u.total > Math.max(0.2, avg * 2)).sort((a, b) => b[1][k] / b[1].total - a[1][k] / a[1].total)[0];
    if (top) insights.push({ kind: top[0].startsWith("g:") ? `${kind}G` : kind, vars: { name: top[1].name, n: top[1][k], total: top[1].total, p: Math.round((top[1][k] / top[1].total) * 100), avg: Math.round(avg * 100) } });
  }
  const debt = [...perStudent].sort((a, b) => b.debt - a.debt)[0];
  if (debt?.debt) insights.push({ kind: "debt", vars: { name: `${debt.s.name} ${debt.s.lastName ?? ""}`.trim(), sum: debt.debt } });
  const ending = perStudent.filter((p) => p.left !== null && p.left <= 1).map((p) => p.s.name);
  if (ending.length) insights.push({ kind: "ending", vars: { names: ending.join(", ") } });

  return { unbilled, later, laterSum, unbilledSum, receivedBy, waitingBy, prepaidBy, cancelledList, movedList, earned, received, waiting, prepaid, total, cancelled, moved, months, perStudent, check, oldestProof, insights };
}
