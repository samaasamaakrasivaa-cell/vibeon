"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { randomUUID } from "node:crypto";
import type { LessonStatus, PayType } from "@prisma/client";
import { db } from "../db";
import { requireUser } from "../auth/session";
import { fromZoned, parseIsoDay } from "../time";
import { getT } from "../i18n/server";

export type Result = { ok: true; id?: string } | { ok: false; error: string };

const SERIES_WEEKS = 26; // еженедельный урок создаётся на полгода вперёд и продлевается сам
const DURATIONS = [30, 45, 60, 90, 120];

async function me() {
  return requireUser("TEACHER");
}

async function ownLesson(id: string, teacherId: string) {
  const l = await db.lessonInstance.findUnique({ where: { id } });
  if (!l || l.teacherId !== teacherId) throw new Error("not found");
  return l;
}

async function ownStudent(id: string, teacherId: string) {
  const s = await db.student.findUnique({ where: { id } });
  if (!s || s.teacherId !== teacherId) throw new Error("not found");
  return s;
}

function refresh(studentId?: string | null) {
  revalidatePath("/teacher", "layout");
  if (studentId) revalidatePath(`/teacher/students/${studentId}`);
}

function parseWhen(date: string, start: string, tz: string) {
  const d = parseIsoDay(date);
  const m = /^(\d{1,2}):(\d{2})$/.exec(start);
  if (!d || !m) return null;
  return fromZoned(d.y, d.m, d.d, +m[1], +m[2], tz);
}

// ───────── Уроки ─────────

export async function createLesson(input: {
  studentId?: string | null;
  isTrial: boolean;
  trialName?: string;
  date: string;
  start: string;
  durationMin: number;
  repeat: boolean;
}): Promise<Result> {
  const { t } = await getT();
  const teacher = await me();
  const startsAt = parseWhen(input.date, input.start, teacher.timezone);
  if (!startsAt) return { ok: false, error: t("sch.err.time") };
  const durationMin = DURATIONS.includes(input.durationMin) ? input.durationMin : 60;

  let student = null;
  if (input.studentId) student = await ownStudent(input.studentId, teacher.id);
  const trialName = input.trialName?.trim().slice(0, 80) || null;
  if (!student && !(input.isTrial && trialName)) return { ok: false, error: t(input.isTrial ? "sch.err.trialName" : "sch.err.student") };

  const base = {
    teacherId: teacher.id,
    studentId: student?.id ?? null,
    durationMin,
    isTrial: input.isTrial,
    trialName: student ? null : trialName,
    price: input.isTrial ? 0 : (student?.price ?? null),
  };
  if (input.repeat && !input.isTrial) {
    const seriesId = randomUUID();
    await db.lessonInstance.createMany({
      data: Array.from({ length: SERIES_WEEKS }, (_, i) => ({ ...base, seriesId, startsAt: new Date(startsAt.getTime() + i * 7 * 864e5) })),
    });
  } else {
    await db.lessonInstance.create({ data: { ...base, startsAt } });
  }
  refresh(student?.id);
  return { ok: true };
}

export async function saveLessonNote(id: string, note: string): Promise<Result> {
  const teacher = await me();
  const l = await ownLesson(id, teacher.id);
  await db.lessonInstance.update({ where: { id }, data: { note: note.trim().slice(0, 2000) || null } });
  refresh(l.studentId);
  return { ok: true };
}

export async function setLessonStatus(id: string, status: LessonStatus, charged = true): Promise<Result> {
  const teacher = await me();
  const l = await ownLesson(id, teacher.id);
  if (!["DONE", "MISSED", "CANCELLED", "PLANNED"].includes(status)) return { ok: false, error: "status" };
  await db.lessonInstance.update({ where: { id }, data: { status, charged: status === "MISSED" ? charged : status === "DONE" } });
  refresh(l.studentId);
  return { ok: true };
}

export async function moveLesson(id: string, date: string, start: string): Promise<Result> {
  const { t } = await getT();
  const teacher = await me();
  const l = await ownLesson(id, teacher.id);
  const startsAt = parseWhen(date, start, teacher.timezone);
  if (!startsAt) return { ok: false, error: t("sch.err.time") };
  // Переносится только этот урок; еженедельная серия остаётся в своё время.
  await db.lessonInstance.update({ where: { id }, data: { startsAt, movedFrom: l.movedFrom ?? l.startsAt, seriesId: null, status: "PLANNED" } });
  refresh(l.studentId);
  return { ok: true };
}

export async function deleteLesson(id: string, scope: "one" | "following" = "one"): Promise<Result> {
  const teacher = await me();
  const l = await ownLesson(id, teacher.id);
  if (scope === "following" && l.seriesId)
    await db.lessonInstance.deleteMany({ where: { seriesId: l.seriesId, startsAt: { gte: l.startsAt }, teacherId: teacher.id } });
  else await db.lessonInstance.delete({ where: { id } });
  refresh(l.studentId);
  return { ok: true };
}

export async function makeWeekly(id: string): Promise<Result> {
  const teacher = await me();
  const l = await ownLesson(id, teacher.id);
  if (l.seriesId || l.isTrial) return { ok: true };
  const seriesId = randomUUID();
  await db.$transaction([
    db.lessonInstance.update({ where: { id }, data: { seriesId } }),
    db.lessonInstance.createMany({
      data: Array.from({ length: SERIES_WEEKS - 1 }, (_, i) => ({
        teacherId: teacher.id, studentId: l.studentId, groupId: l.groupId, durationMin: l.durationMin, price: l.price, seriesId,
        startsAt: new Date(l.startsAt.getTime() + (i + 1) * 7 * 864e5),
      })),
    }),
  ]);
  refresh(l.studentId);
  return { ok: true };
}

/** Перевести пробный урок на ученика (после приглашения). */
export async function attachTrialToStudent(lessonId: string, studentId: string): Promise<Result> {
  const teacher = await me();
  await ownLesson(lessonId, teacher.id);
  await ownStudent(studentId, teacher.id);
  await db.lessonInstance.update({ where: { id: lessonId }, data: { studentId, trialName: null } });
  refresh(studentId);
  return { ok: true };
}

// ───────── Ученики ─────────

const clean = (v: unknown, max = 200) => (typeof v === "string" ? v.trim().slice(0, max) : "") || null;

export async function updateStudentProfile(id: string, f: Record<string, string>): Promise<Result> {
  const { t } = await getT();
  const teacher = await me();
  await ownStudent(id, teacher.id);
  const name = clean(f.name, 80);
  if (!name) return { ok: false, error: t("auth.err.name") };
  const bday = f.birthday && /^\d{4}-\d{2}-\d{2}$/.test(f.birthday) ? new Date(f.birthday + "T12:00:00Z") : null;
  const started = f.startedAt && /^\d{4}-\d{2}-\d{2}$/.test(f.startedAt) ? new Date(f.startedAt + "T12:00:00Z") : null;
  await db.student.update({
    where: { id },
    data: {
      name, lastName: clean(f.lastName, 80), email: clean(f.email)?.toLowerCase() ?? null, telegram: clean(f.telegram, 40),
      timezone: clean(f.timezone, 60) ?? "Europe/Moscow", callLink: clean(f.callLink, 500), course: clean(f.course, 120),
      level: clean(f.level, 60), interests: clean(f.interests, 300), examGoal: clean(f.examGoal, 120), source: clean(f.source, 120),
      birthday: bday, startedAt: started,
    },
  });
  if (f.phone !== undefined) {
    const s = await db.student.findUnique({ where: { id }, select: { form: true } });
    await db.student.update({ where: { id }, data: { form: { ...((s?.form as object) ?? {}), phone: clean(f.phone, 40) } } });
  }
  refresh(id);
  return { ok: true };
}

export async function savePrivateNote(id: string, text: string): Promise<Result> {
  const teacher = await me();
  await ownStudent(id, teacher.id);
  await db.student.update({ where: { id }, data: { privateNote: text.slice(0, 5000) || null } });
  return { ok: true };
}

export async function savePayment(
  id: string,
  p: { payType: PayType; billRule: string; remindEveryDays: number | null; price: number | null; packPrices: { n: number; price: number }[]; payerOn: boolean; payerName: string; payerContact: string },
): Promise<Result> {
  const teacher = await me();
  await ownStudent(id, teacher.id);
  const price = p.price && p.price > 0 && p.price < 1_000_000 ? Math.round(p.price) : null;
  const packPrices = (p.packPrices ?? []).filter((x) => [4, 8, 12, 16, 20].includes(x.n) && x.price > 0 && x.price < 10_000_000).map((x) => ({ n: x.n, price: Math.round(x.price) }));
  await db.student.update({
    where: { id },
    data: {
      payType: p.payType === "PACK" ? "PACK" : "POSTPAID",
      billRule: clean(p.billRule, 40),
      remindEveryDays: [1, 3, 7].includes(p.remindEveryDays ?? 0) ? p.remindEveryDays : null,
      price,
      packPrices,
      payerName: p.payerOn ? clean(p.payerName, 120) : null,
      payerContact: p.payerOn ? clean(p.payerContact, 200) : null,
    },
  });
  // Будущие запланированные уроки получают новую цену
  if (price) await db.lessonInstance.updateMany({ where: { studentId: id, status: "PLANNED", startsAt: { gt: new Date() }, isTrial: false }, data: { price } });
  refresh(id);
  return { ok: true };
}

export async function addPack(id: string, lessons: number, price: number): Promise<Result> {
  const { t } = await getT();
  const teacher = await me();
  await ownStudent(id, teacher.id);
  if (!(lessons > 0 && lessons <= 100) || !(price >= 0)) return { ok: false, error: t("prof.err.pack") };
  await db.pack.create({ data: { studentId: id, lessonsTotal: lessons, lessonsLeft: lessons, price: Math.round(price) } });
  refresh(id);
  return { ok: true };
}

export async function archiveStudent(id: string, archive: boolean): Promise<Result> {
  const teacher = await me();
  await ownStudent(id, teacher.id);
  await db.student.update({ where: { id }, data: { status: archive ? "ARCHIVED" : "ACTIVE", archivedAt: archive ? new Date() : null } });
  if (archive) await db.lessonInstance.deleteMany({ where: { studentId: id, status: "PLANNED", startsAt: { gt: new Date() } } });
  refresh(id);
  return { ok: true };
}

export async function deleteStudent(id: string): Promise<never> {
  const teacher = await me();
  const s = await ownStudent(id, teacher.id);
  await db.$transaction(async (tx) => {
    await tx.student.delete({ where: { id } });
    // Аккаунт ученика удаляется вместе с анкетой (персональные данные — по запросу о удалении).
    if (s.userId) await tx.user.delete({ where: { id: s.userId } });
  });
  redirect("/teacher/students");
}

/** Отметка «сделано» в «Что нового». */
export async function setNotificationDone(id: string, done: boolean): Promise<Result> {
  const user = await requireUser();
  const n = await db.notification.findUnique({ where: { id } });
  if (!n || n.userId !== user.id) return { ok: false, error: "not found" };
  await db.notification.update({ where: { id }, data: { doneAt: done ? new Date() : null, readAt: n.readAt ?? new Date() } });
  revalidatePath("/teacher");
  revalidatePath("/student");
  return { ok: true };
}

export async function markAllRead(): Promise<Result> {
  const user = await requireUser();
  await db.notification.updateMany({ where: { userId: user.id, readAt: null }, data: { readAt: new Date() } });
  revalidatePath("/teacher");
  revalidatePath("/student");
  return { ok: true };
}
