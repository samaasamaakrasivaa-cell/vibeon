import "server-only";
import { db } from "../db";
import { isoDay } from "../time";
import { selfStudyMinutes } from "../study/data";

// Сколько ученик позанимался: уроки (по длительности), домашка (≈ 6 мин на задание), слова (≈ 30 с на слово).
const HW_MIN = 6, WORD_MIN = 0.5;

type HoursClient = Pick<typeof db, "lessonInstance" | "answer" | "wordPractice" | "studyLog">;

export async function hours(studentId: string, from: Date, to: Date, client: HoursClient = db) {
  const [lessons, answers, practice] = await Promise.all([
    client.lessonInstance.findMany({ where: { studentId, status: "DONE", isTrial: false, startsAt: { gte: from, lt: to } }, select: { durationMin: true } }),
    client.answer.count({ where: { studentId, status: { not: "DRAFT" }, updatedAt: { gte: from, lt: to }, lessonInstance: { status: "DONE" } } }),
    client.wordPractice.findMany({ where: { studentId, day: { gte: isoDay(from, "UTC"), lt: isoDay(to, "UTC") } }, select: { count: true } }),
  ]);
  const les = lessons.reduce((a, l) => a + l.durationMin, 0) / 60;
  // своя самостоятельная работа из расписания (фильм, чтение, говорение…), отмеченная «сделал»
  const self = (await selfStudyMinutes(studentId, isoDay(from, "UTC"), isoDay(to, "UTC"), client)) / 60;
  return { les, hw: (answers * HW_MIN) / 60, wd: (practice.reduce((a, p) => a + p.count, 0) * WORD_MIN) / 60, self, lessons: lessons.length };
}

export async function roadmapHours(r: { studentId: string; approvedAt: Date | null; createdAt: Date; startHours: number }, client: HoursClient = db) {
  const all = await hours(r.studentId, r.approvedAt ?? r.createdAt, new Date(Date.now() + 864e5), client);
  return r.startHours + all.les + all.hw + all.wd + all.self;
}
