import "server-only";
import { db } from "../db";
import { isoDay, minutesOfDay, partsIn } from "../time";
import { notify } from "../notify";
import { isKind } from "./kinds";

const RU: Record<string, string> = { homework: "домашка", film: "фильм / сериал", podcast: "подкаст / аудио", reading: "чтение", speaking: "говорение", grammar: "грамматика", club: "разговорный клуб", exam: "подготовка к экзамену", other: "другое занятие" };
const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

/** Свои слоты ученика: напоминание в Telegram за 15 минут до начала (один раз на слот в день). Слова напоминаются по своим настройкам. */
export async function studyReminders(now = new Date()) {
  const slots = await db.studySlot.findMany({ where: { remind: true, student: { status: "ACTIVE", userId: { not: null } } }, include: { student: { select: { id: true, userId: true, user: { select: { timezone: true } } } } } });
  for (const sl of slots) {
    if (!isKind(sl.kind)) continue;
    const tz = sl.student.user?.timezone ?? "Europe/Moscow";
    const day = isoDay(now, tz), dow = partsIn(now, tz).dow, cur = minutesOfDay(now, tz);
    const today = sl.repeat ? sl.weekday === dow && day >= sl.from && (!sl.until || day < sl.until) : sl.date === day;
    if (!today || cur < sl.startMin - 15 || cur >= sl.startMin) continue;
    const log = await db.studyLog.findUnique({ where: { slotId_day: { slotId: sl.id, day } } });
    if (log) continue; // перенесено, убрано или уже сделано
    let link = "/student/schedule";
    if (sl.kind === "homework") {
      const hw = await db.homework.findFirst({ where: { status: "ASSIGNED", lessonInstance: { studentId: sl.student.id } }, orderBy: { lessonInstance: { startsAt: "desc" } }, select: { lessonInstanceId: true } });
      if (hw) link = `/class/${hw.lessonInstanceId}?tab=homework`;
    }
    const what = sl.title ? `${RU[sl.kind]}: ${sl.title}` : RU[sl.kind];
    await notify({ userId: sl.student.userId!, kind: "lesson", title: `В ${hhmm(sl.startMin)} — ${what} (${sl.durMin} мин). Вы сами запланировали это время 🙂`, link, dedupe: `study:${sl.id}:${day}` }).catch((e) => console.error("[study]", e));
  }
}
