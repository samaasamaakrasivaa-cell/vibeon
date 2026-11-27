import "server-only";
import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { db } from "../db";
import { publishedSelfStudy } from "../roadmap/self-study";
import { addDaysIso, dayStart, isoDay, minutesOfDay } from "../time";
import { onDay } from "./data";
import { wordsMin } from "./kinds";
import { localInterval, type BusyInterval, type PlannedActivity } from "./weekly-plan";

type CalendarClient = Pick<Prisma.TransactionClient, "lessonInstance" | "studySlot" | "studyLog" | "roadmap">;
type WordSettings = { id: string; remindAt: string; wordDays: number[]; wordGoal: number };

export async function schedulePlan(studentId: string, client: CalendarClient = db) {
  const roadmap = await client.roadmap.findFirst({
    where: { studentId }, orderBy: { createdAt: "desc" },
    select: { id: true, approvedAt: true, meta: true, aiDraft: true, pace: true, paceStudent: true },
  });
  const plan = publishedSelfStudy(roadmap);
  if (!roadmap || !plan) return null;
  const items = plan.items.map(({ activity, skill, minutes, times_per_week }) => ({ activity, skill, minutes, times: times_per_week }));
  const revision = createHash("sha256").update(JSON.stringify([roadmap.id, roadmap.approvedAt, items])).digest("hex");
  return { revision, items };
}

/** Use real lesson instants, and interpret each personal slot in the student's time zone. */
export async function draftCalendar(student: WordSettings, monday: string, tz: string, client: CalendarClient = db) {
  const studentId = student.id;
  const previous = addDaysIso(monday, -1);
  const last = addDaysIso(monday, 6);
  const [lessons, slots, excluded] = await Promise.all([
    client.lessonInstance.findMany({
      where: { studentId, status: { notIn: ["CANCELLED", "MISSED"] }, startsAt: { gte: dayStart(previous, tz), lt: dayStart(addDaysIso(monday, 7), tz) } },
      select: { startsAt: true, durationMin: true },
    }),
    client.studySlot.findMany({ where: { studentId, OR: [
      { repeat: true, from: { lte: last }, OR: [{ until: null }, { until: { gt: previous } }] },
      { repeat: false, date: { gte: previous, lte: last } },
    ] } }),
    client.studyLog.findMany({
      where: { studentId, day: { gte: previous, lte: last }, status: { in: ["moved", "removed"] } },
      select: { slotId: true, day: true },
    }),
  ]);
  const busy: BusyInterval[] = lessons.map((lesson) => {
    const start = lesson.startsAt.getTime();
    return { ...localInterval(isoDay(lesson.startsAt, tz), minutesOfDay(lesson.startsAt, tz), lesson.durationMin, tz), start, end: start + lesson.durationMin * 60_000 };
  });
  const existing: PlannedActivity[] = [];
  const skipped = new Set(excluded.map((log) => `${log.slotId}:${log.day}`));
  const [hour, minute] = student.remindAt.split(":").map(Number);
  for (let day = -1; day < 7; day++) {
    const date = addDaysIso(monday, day);
    const weekday = (day + 7) % 7;
    for (const slot of slots) {
      if (!onDay(slot, date, weekday) || skipped.has(`${slot.id}:${date}`)) continue;
      busy.push(localInterval(date, slot.startMin, slot.durMin, tz));
      if (day >= 0) existing.push({ kind: slot.kind, title: slot.title });
    }
    if (student.wordDays.includes(weekday)) busy.push(localInterval(date, (hour || 0) * 60 + (minute || 0), wordsMin(student.wordGoal), tz));
  }
  return { busy, existing };
}
