import "server-only";

import { createHash, randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { db } from "../db";
import { lessonAnalysisAvailable, lessonAnalysisChat } from "../ai/gateway";
import { LESSON_ANALYSIS_MODEL, LESSON_ANALYSIS_MONTHLY_LIMIT, lessonAnalysisInput, localPractice, type Practice } from "../ai/lesson-analysis-plan";
import { lessonModelEvidence, lessonTaskEvidence, type LessonTaskEvidence } from "./analysis-facts";

const RESERVATION_KIND = "lesson-analysis-reservation";
const GENERATION_WINDOW = 60_000;
const key = "lessonAnalysisV1";

export type LessonAnalysis = {
  state: "draft" | "private" | "published";
  teacherId: string;
  studentId: string;
  startsAt: string;
  finishedAt: string | null;
  tasks: LessonTaskEvidence[];
  practice: Practice[];
  source: "local" | "ai";
  pendingUntil: number | null;
};

type Client = Prisma.TransactionClient;
type LessonBinding = { teacherId: string | null; studentId: string | null; startsAt: Date; finishedAt: Date | null };

function readAnalysis(notes: unknown, lesson: LessonBinding): LessonAnalysis | null {
  const report = (notes as { lessonAnalysisV1?: LessonAnalysis } | null)?.lessonAnalysisV1;
  if (!report || report.teacherId !== lesson.teacherId || report.studentId !== lesson.studentId ||
      report.startsAt !== lesson.startsAt.toISOString() || report.finishedAt !== (lesson.finishedAt?.toISOString() ?? null)) return null;
  return report;
}

export const analysisPending = (report: LessonAnalysis) => (report.pendingUntil ?? 0) > Date.now();

function teacherLesson(client: Client, id: string, teacherId: string) {
  return client.lessonInstance.findFirst({
    where: { id, teacherId, status: "DONE", student: { teacherId, teacher: { blockedAt: null } } },
    select: { id: true, teacherId: true, studentId: true, slotId: true, startsAt: true, finishedAt: true, templateId: true, live: true,
      student: { select: { id: true, name: true, lastName: true } } },
  });
}

async function snapshot(client: Client, id: string, studentId: string) {
  return client.lessonSummary.findUnique({
    where: { lessonInstanceId_studentId: { lessonInstanceId: id, studentId } }, select: { notes: true },
  });
}

async function evidenceFor(client: Client, lesson: { id: string; studentId: string; templateId: string | null; slotId: string | null; teacherId: string | null; live: unknown }) {
  if (!lesson.templateId) return [];
  const host = lesson.slotId && await client.lessonInstance.findFirst({ where: { slotId: lesson.slotId, teacherId: lesson.teacherId },
    orderBy: { id: "asc" }, select: { live: true } });
  const hidden = (host ? host.live : lesson.live) as { hidden?: string[] } | null;
  const answers = await client.answer.findMany({
    where: { lessonInstanceId: lesson.id, studentId: lesson.studentId,
      task: { templateId: lesson.templateId, section: "lesson", hidden: false, ...(Array.isArray(hidden?.hidden) ? { id: { notIn: hidden.hidden } } : {}) } },
    select: { taskId: true, payload: true, lessonMs: true, hwMs: true, task: { select: { id: true, type: true, title: true, content: true, section: true, options: true } } },
    orderBy: [{ task: { order: "asc" } }, { taskId: "asc" }],
  });
  return lessonTaskEvidence(answers.map((row) => row.task), answers);
}

export async function teacherLessonAnalysis(id: string, teacherId: string) {
  const lesson = await teacherLesson(db, id, teacherId);
  if (!lesson?.student || !lesson.studentId) return null;
  const stored = await snapshot(db, id, lesson.studentId);
  const report = readAnalysis(stored?.notes, lesson);
  const tasks = report?.tasks ?? await evidenceFor(db, { ...lesson, studentId: lesson.studentId });
  const participants = lesson.slotId ? await db.lessonInstance.findMany({
    where: { slotId: lesson.slotId, teacherId, status: "DONE", student: { teacherId } },
    select: { id: true, student: { select: { name: true, lastName: true } } }, orderBy: { id: "asc" },
  }) : [];
  return { lesson, report, tasks, participants, canCallAi: lessonAnalysisAvailable() && lessonModelEvidence(tasks).length > 0 };
}

async function withTeacherLesson<T>(id: string, teacherId: string, act: (client: Client,
  lesson: NonNullable<Awaited<ReturnType<typeof teacherLesson>>> & { studentId: string }) => Promise<T>) {
  return db.$transaction(async (client) => {
    const [locked] = await client.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "LessonInstance" WHERE "id" = ${id} AND "teacherId" = ${teacherId} FOR UPDATE
    `;
    if (!locked) return null;
    const lesson = await teacherLesson(client, id, teacherId);
    if (!lesson?.studentId) return null;
    return act(client, { ...lesson, studentId: lesson.studentId });
  });
}

async function saveAnalysis(client: Client, lessonId: string, report: LessonAnalysis) {
  const notes = JSON.stringify({ [key]: report });
  await client.$executeRaw`
    INSERT INTO "LessonSummary" ("id", "lessonInstanceId", "studentId", "notes", "status", "updatedAt")
    VALUES (${randomUUID()}, ${lessonId}, ${report.studentId}, ${notes}::jsonb, 'analysis-only', CURRENT_TIMESTAMP)
    ON CONFLICT ("lessonInstanceId", "studentId") DO UPDATE SET
      "notes" = "LessonSummary"."notes" || EXCLUDED."notes"
  `;
}

async function reserve(client: Client, id: string, teacherId: string) {
  // Serialize only the database reservation across app instances, with no network calls under the lock.
  await client.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(791437169)`;
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const token = `lesson-analysis:${createHash("sha256").update(id).digest("hex")}`;
  if (await client.aiCall.findUnique({ where: { id: token }, select: { id: true } })) return null;
  const calls = await client.aiCall.count({ where: { kind: RESERVATION_KIND, createdAt: { gte: start } } });
  if (calls >= LESSON_ANALYSIS_MONTHLY_LIMIT) return null;
  await client.aiCall.create({ data: { id: token, teacherId, userId: teacherId, kind: RESERVATION_KIND,
    provider: "yandex", model: LESSON_ANALYSIS_MODEL, ok: false, createdAt: now } });
  return token;
}

export async function generateLessonAnalysis(id: string, teacherId: string, allowAi: boolean) {
  const attempt = await withTeacherLesson(id, teacherId, async (client, lesson) => {
    const stored = await snapshot(client, id, lesson.studentId);
    if (readAnalysis(stored?.notes, lesson)) return null;
    const tasks = await evidenceFor(client, lesson);
    if (!tasks.length) return null;
    const evidence = lessonModelEvidence(tasks);
    const token = allowAi && evidence.length && lessonAnalysisAvailable() ? await reserve(client, id, teacherId) : null;
    const report: LessonAnalysis = { state: "draft", teacherId, studentId: lesson.studentId,
      startsAt: lesson.startsAt.toISOString(), finishedAt: lesson.finishedAt?.toISOString() ?? null, tasks,
      practice: localPractice(evidence), source: "local", pendingUntil: token ? Date.now() + GENERATION_WINDOW : null };
    await saveAnalysis(client, id, report);
    return { token, report, input: lessonAnalysisInput(evidence) };
  });
  if (!attempt?.token) return;

  const practice = await lessonAnalysisChat(attempt.input, attempt.token, { teacherId, userId: teacherId }).catch(() => null);
  await withTeacherLesson(id, teacherId, async (client, lesson) => {
    const stored = await snapshot(client, id, lesson.studentId);
    const report = readAnalysis(stored?.notes, lesson);
    if (!report || report.state !== "draft" || report.pendingUntil !== attempt.report.pendingUntil) return;
    await saveAnalysis(client, id, { ...report, pendingUntil: null,
      ...(practice && analysisPending(report) ? { practice, source: "ai" } : {}) });
  });
}

export async function approveLessonAnalysis(id: string, teacherId: string, publish: boolean) {
  return withTeacherLesson(id, teacherId, async (client, lesson) => {
    const stored = await snapshot(client, id, lesson.studentId);
    const report = readAnalysis(stored?.notes, lesson);
    if (!report || report.state === "published" || analysisPending(report)) return false;
    await saveAnalysis(client, id, { ...report, state: publish ? "published" : "private", pendingUntil: null });
    return true;
  });
}

export async function publishedLessonAnalysis(id: string, userId: string) {
  const lesson = await db.lessonInstance.findFirst({
    where: { id, status: "DONE", student: { userId } },
    select: { id: true, startsAt: true, finishedAt: true, teacherId: true, studentId: true },
  });
  if (!lesson?.studentId) return null;
  const stored = await snapshot(db, id, lesson.studentId);
  const report = readAnalysis(stored?.notes, lesson);
  if (report?.state !== "published") return null;
  const tasks = report.tasks.map((task) => ({ ...task, title: "", topicName: null }));
  return { date: lesson.startsAt, tasks, practice: report.practice };
}

export async function recentPublishedAnalysis(studentId: string, userId: string) {
  const rows = await db.lessonSummary.findMany({
    where: { studentId, notes: { path: [key, "state"], equals: "published" },
      lessonInstance: { status: "DONE", studentId, student: { userId } } },
    select: { notes: true, lessonInstance: { select: { id: true, startsAt: true, finishedAt: true, teacherId: true, studentId: true } } },
    orderBy: { lessonInstance: { startsAt: "desc" } }, take: 10,
  });
  return rows.flatMap(({ notes, lessonInstance }) => readAnalysis(notes, lessonInstance)?.state === "published"
    ? [{ id: lessonInstance.id, date: lessonInstance.startsAt }] : []).slice(0, 5);
}
