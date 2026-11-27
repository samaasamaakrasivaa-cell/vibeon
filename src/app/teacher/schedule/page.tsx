import Link from "next/link";
import { Icon } from "@/components/Icon";
import { WeekGrid, type GridLesson, type GridOff } from "@/components/teacher/WeekGrid";
import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getT } from "@/lib/i18n/server";
import { addDaysIso, dayStart, hhmm, isoDay, minutesOfDay, mondayOf, parseIsoDay, partsIn, weekRange } from "@/lib/time";
import { earnedOf, lessonInclude, lessonWho, oneScheduledSlot, oneSlot, rub, syncSchedule } from "@/lib/teacher/data";
import { initials } from "@/lib/invite";
import { homeworkFor } from "@/lib/homework";
import { payStateOf } from "@/lib/billing/lesson-pay";

export const metadata = { title: "Расписание" };

export default async function Schedule({ searchParams }: { searchParams: Promise<{ w?: string; new?: string; student?: string; group?: string; trial?: string; date?: string }> }) {
  const { t, lang } = await getT();
  const me = await requireUser("TEACHER");
  const tz = me.timezone;
  const sp = await searchParams;
  await syncSchedule(me.id);

  const todayIso = isoDay(new Date(), tz);
  const monday = mondayOf(parseIsoDay(sp.w) ? sp.w! : todayIso);
  const from = dayStart(monday, tz);
  const to = dayStart(addDaysIso(monday, 7), tz);

  const [rows, students, hws, groups, offRows] = await Promise.all([
    db.lessonInstance.findMany({ where: { teacherId: me.id, startsAt: { gte: from, lt: to } }, include: lessonInclude, orderBy: { startsAt: "asc" } }),
    db.student.findMany({ where: { teacherId: me.id, status: { in: ["ACTIVE", "INVITED"] } }, orderBy: [{ status: "asc" }, { name: "asc" }] }),
    homeworkFor({ teacherId: me.id }),
    db.group.findMany({ where: { teacherId: me.id }, include: { members: { include: { student: { select: { name: true, lastName: true } } } } }, orderBy: { title: "asc" } }),
    // нерабочее время: разовое в эту неделю и повторяющееся, начатое не позже конца недели
    db.timeOff.findMany({ where: { teacherId: me.id, OR: [{ weekly: false, startsAt: { lt: to }, endsAt: { gt: from } }, { weekly: true, startsAt: { lt: to } }] } }),
  ]);
  // повторяющееся — в тот же день недели этой недели (если серия уже началась)
  const offs: GridOff[] = offRows.flatMap((o) => {
    const dur = Math.round((o.endsAt.getTime() - o.startsAt.getTime()) / 60000);
    const firstIso = isoDay(o.startsAt, tz);
    const dows = (iso: string) => (new Date(`${iso}T12:00:00Z`).getUTCDay() + 6) % 7;
    const dayIso = o.weekly ? addDaysIso(monday, dows(firstIso)) : firstIso;
    if (o.weekly && dayIso < firstIso) return [];
    const day = Math.round((dayStart(dayIso, tz).getTime() - from.getTime()) / 864e5);
    if (day < 0 || day > 6) return [];
    const startMin = minutesOfDay(o.startsAt, tz);
    const endMin = Math.min(24 * 60, startMin + dur);
    const fmt = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
    return [{ id: o.id, day, date: dayIso, startMin, endMin, start: fmt(startMin), end: fmt(endMin), weekly: o.weekly, note: o.note }];
  });
  const groupOf = new Map(groups.map((g) => [g.id, g]));
  // уроки в счетах, которые уже оплачены или ждут подтверждения оплаты, — цену не меняем
  const invs = await db.invoice.findMany({ where: { lessonIds: { hasSome: rows.map((l) => l.id) } }, select: { id: true, status: true, lessonIds: true, proofKind: true } });
  const locked = new Set(invs.filter((i) => i.status === "PROOF_SENT" || i.status === "PAID").flatMap((i) => i.lessonIds));
  // оплата урока: оплачен / счёт ждёт оплаты / списан из абонемента / не оплачен — «Оплачено» можно отметить всегда
  const priceRow = (l: (typeof rows)[number]) => ({ id: l.id, name: l.student ? [l.student.name, l.student.lastName].filter(Boolean).join(" ") : (l.trialName ?? "—"), price: l.price ?? 0, locked: locked.has(l.id), counts: earnedOf(l) > 0, pay: l.studentId ? payStateOf(l, invs) : null });
  // групповое занятие — одним блоком; у кого из группы урок — по урокам этого занятия
  const slotMembers = new Map<string, string[]>();
  for (const l of rows) if (l.slotId && l.student) slotMembers.set(l.slotId, [...(slotMembers.get(l.slotId) ?? []), l.student.name]);
  const hwOf = new Map(hws.map((h) => [h.lesson.id, h.state]));

  const loc = lang === "ru" ? "ru-RU" : "en-GB";
  const now = new Date();
  // одинаковые имена у разных учеников — в сетке добавляем первую букву фамилии
  const firstCount = new Map<string, number>();
  for (const s of students) firstCount.set(s.name.trim().toLowerCase(), (firstCount.get(s.name.trim().toLowerCase()) ?? 0) + 1);
  const shortOf = (l: (typeof rows)[number]) => {
    if (!l.student) return undefined;
    const n = l.student.name.trim();
    return (firstCount.get(n.toLowerCase()) ?? 0) > 1 && l.student.lastName ? `${n} ${l.student.lastName.trim().charAt(0).toUpperCase()}.` : n;
  };
  const lessons: GridLesson[] = oneScheduledSlot(rows).map((l) => {
    const end = new Date(l.startsAt.getTime() + l.durationMin * 60000);
    const day = Math.round((dayStart(isoDay(l.startsAt, tz), tz).getTime() - from.getTime()) / 864e5);
    return {
      id: l.id, day, startMin: minutesOfDay(l.startsAt, tz), dur: l.durationMin, status: l.status, who: lessonWho(l),
      isTrial: l.isTrial, isGroup: !!l.group, note: l.note, date: isoDay(l.startsAt, tz), start: hhmm(l.startsAt, tz), end: hhmm(end, tz),
      weekly: !!l.seriesId, past: end <= now, studentId: l.studentId, charged: l.charged, moved: !!l.movedFrom, price: l.price ?? 0,
      hw: hwOf.get(l.id) ?? null,
      short: l.slotId ? undefined : shortOf(l),
      prices: (l.slotId ? rows.filter((x) => x.slotId === l.slotId) : [l]).map(priceRow),
      callLink: (l.groupId ? l.group?.callLink : l.student?.callLink) || l.callLink || null,
      group: l.slotId && l.groupId ? { id: l.groupId, members: slotMembers.get(l.slotId) ?? [] } : null,
      ...(l.slotId ? { who: groupOf.get(l.groupId ?? "")?.title ?? (slotMembers.get(l.slotId) ?? []).join(", "), isGroup: true, studentId: null, price: rows.filter((x) => x.slotId === l.slotId).reduce((a, x) => a + (x.price ?? 0), 0) } : {}),
    };
  });

  // Часы сетки: 8:00–21:00, расширяется под уроки раньше/позже
  let hourFrom = 8, hourTo = 21;
  for (const l of lessons) {
    if (l.status === "CANCELLED") continue;
    hourFrom = Math.min(hourFrom, Math.floor(l.startMin / 60));
    hourTo = Math.max(hourTo, Math.min(24, Math.ceil((l.startMin + l.dur) / 60)));
  }

  const weekTotal = rows.reduce((s, l) => s + earnedOf(l), 0);
  const days = Array.from({ length: 7 }, (_, i) => {
    const iso = addDaysIso(monday, i);
    const d = dayStart(iso, tz);
    const dayRows = rows.filter((l) => isoDay(l.startsAt, tz) === iso);
    const earned = dayRows.reduce((s, l) => s + earnedOf(l), 0);
    // из чего сложилась сумма дня: по занятиям, у группового — сумма по ученикам
    const tip = oneSlot(dayRows).map((l) => {
      const part = l.slotId ? dayRows.filter((x) => x.slotId === l.slotId) : [l];
      const sum = part.reduce((s, x) => s + earnedOf(x), 0);
      if (!sum) return null;
      const who = l.slotId ? `${groupOf.get(l.groupId ?? "")?.title ?? lessonWho(l)} (${part.filter((x) => earnedOf(x) > 0).map((x) => rub(earnedOf(x), lang)).join(" + ")})` : lessonWho(l);
      return `${hhmm(l.startsAt, tz)} ${who} — ${rub(sum, lang)}`;
    }).filter(Boolean).join("\n");
    return {
      iso, num: parseIsoDay(iso)!.d, today: iso === todayIso, past: iso < todayIso, earned: earned ? rub(earned, lang) : null, tip,
      dow: new Date(d.getTime() + 12 * 3600e3).toLocaleDateString(loc, { weekday: "short", timeZone: tz }).replace(".", ""),
    };
  });
  const nowDay = days.findIndex((d) => d.today);

  return (
    <div className="page" style={{ maxWidth: 1100 }}>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1>{t("nav.schedule")}</h1>
        <div className="flex items-center gap-2">
          {monday !== mondayOf(todayIso) && <Link href="/teacher/schedule" className="btn secondary sm">{t("dash.today")}</Link>}
          <div className="weeknav">
            <Link href={`/teacher/schedule?w=${addDaysIso(monday, -7)}`} aria-label={t("sch.prev")}><Icon name="chevl" size="sm" /></Link>
            <span>{weekRange(monday, tz, loc)}</span>
            <Link href={`/teacher/schedule?w=${addDaysIso(monday, 7)}`} aria-label={t("sch.next")}><Icon name="right" size="sm" /></Link>
          </div>
        </div>
      </div>
      <section className="card" style={{ padding: "20px 20px 18px" }}>
        <WeekGrid
          days={days}
          lessons={lessons}
          offs={offs}
          hourFrom={hourFrom}
          hourTo={hourTo}
          nowDay={nowDay}
          todayIso={todayIso}
          nowMin={partsIn(now, tz).h * 60 + partsIn(now, tz).min}
          students={students.map((s) => ({ id: s.id, name: [s.name, s.lastName].filter(Boolean).join(" "), initials: initials(s.name, s.lastName) }))}
          groups={groups.filter((g) => g.members.length).map((g) => ({ id: g.id, name: `${g.title} · ${g.members.length}`, initials: g.title.slice(0, 2).toUpperCase() }))}
          weekTotal={rub(weekTotal, lang)}
          legend
          preset={sp.new ? { studentId: sp.student, groupId: sp.group, trial: sp.trial === "1", date: parseIsoDay(sp.date) ? sp.date : undefined } : undefined}
        />
      </section>
      <p className="hint mt-3">{t("sch.hint")}</p>
    </div>
  );
}
