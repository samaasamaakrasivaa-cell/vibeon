import "server-only";
import { db } from "../db";

/** Прошедшие запланированные уроки считаем проведёнными; учитель может поменять на «пропуск» или «отмену». */
export async function autoCompletePast(teacherId: string) {
  await db.$executeRaw`
    UPDATE "LessonInstance" SET status = 'DONE'
    WHERE "teacherId" = ${teacherId} AND status = 'PLANNED'
      AND "startsAt" + ("durationMin" * interval '1 minute') < (now() at time zone 'UTC')`; // startsAt хранится в UTC без пояса
}

/** Еженедельные серии продлеваются сами, когда до их конца остаётся меньше 8 недель. */
export async function extendSeries(teacherId: string) {
  const horizon = new Date(Date.now() + 8 * 7 * 864e5);
  const series = await db.lessonInstance.groupBy({
    by: ["seriesId"],
    where: { teacherId, seriesId: { not: null } },
    _max: { startsAt: true },
  });
  for (const s of series) {
    if (!s.seriesId || !s._max.startsAt || s._max.startsAt > horizon) continue;
    const last = await db.lessonInstance.findFirst({ where: { seriesId: s.seriesId, startsAt: s._max.startsAt } });
    if (!last || (last.studentId && !(await db.student.findFirst({ where: { id: last.studentId, status: "ACTIVE" } })))) continue;
    await db.lessonInstance.createMany({
      data: Array.from({ length: 26 }, (_, i) => ({
        teacherId, studentId: last.studentId, groupId: last.groupId, durationMin: last.durationMin, price: last.price,
        seriesId: s.seriesId, startsAt: new Date(last.startsAt.getTime() + (i + 1) * 7 * 864e5),
      })),
    });
  }
}

export async function syncSchedule(teacherId: string) {
  await autoCompletePast(teacherId);
  await extendSeries(teacherId);
}

export const lessonInclude = {
  student: { select: { id: true, name: true, lastName: true, price: true } },
  group: { select: { id: true, title: true } },
} as const;

export function lessonWho(l: { trialName: string | null; student: { name: string; lastName: string | null } | null; group: { title: string } | null }) {
  return l.group?.title ?? (l.student ? [l.student.name, l.student.lastName].filter(Boolean).join(" ") : (l.trialName ?? "—"));
}

/** Сколько заработано: проведённые уроки и оплачиваемые пропуски (пробные не считаются). */
export function earnedOf(l: { status: string; charged: boolean; isTrial: boolean; price: number | null }) {
  // пробный: бесплатный (цена 0) не считается; платный — как проведённый урок
  if (l.isTrial) return l.status === "DONE" ? (l.price ?? 0) : 0;
  return (l.status === "DONE" || (l.status === "MISSED" && l.charged)) ? (l.price ?? 0) : 0;
}

export const rub = (n: number, lang: "ru" | "en" = "ru") =>
  new Intl.NumberFormat(lang === "ru" ? "ru-RU" : "en-GB").format(n).replace(/,/g, " ") + " ₽";
