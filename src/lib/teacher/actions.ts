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

export async function moveLesson(id: string, date: string, start: string, fix = false): Promise<Result> {
  const { t } = await getT();
  const teacher = await me();
  const l = await ownLesson(id, teacher.id);
  const startsAt = parseWhen(date, start, teacher.timezone);
  if (!startsAt) return { ok: false, error: t("sch.err.time") };
  // Переносится только этот урок; еженедельная серия остаётся в своё время.
  // fix — исправление ошибки (неверно поставили дату): не считается переносом и не попадает в статистику переносов.
  const past = startsAt.getTime() + l.durationMin * 60000 < Date.now();
  await db.lessonInstance.update({
    where: { id },
    data: { startsAt, movedFrom: fix ? l.movedFrom : l.movedFrom ?? l.startsAt, seriesId: null, status: fix && past ? l.status : "PLANNED", ...(!past ? { deductedAt: null } : {}) },
  });
  if (!past) await restorePackLesson(l);
  refresh(l.studentId);
  return { ok: true };
}

/** Урок уже списан из абонемента, а его удалили или перенесли в будущее — вернуть урок в абонемент. */
async function restorePackLesson(l: { studentId: string | null; deductedAt: Date | null }) {
  if (!l.studentId || !l.deductedAt) return;
  const pack = await db.pack.findFirst({ where: { studentId: l.studentId }, orderBy: { startsAt: "desc" } });
  if (pack && pack.lessonsLeft < pack.lessonsTotal) await db.pack.update({ where: { id: pack.id }, data: { lessonsLeft: { increment: 1 } } });
}

export async function deleteLesson(id: string, scope: "one" | "following" = "one"): Promise<Result> {
  const teacher = await me();
  const l = await ownLesson(id, teacher.id);
  await restorePackLesson(l);
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
  p: { payType: PayType; billRule: string; remindEveryDays: number | null; price: number | null; packPrices: { n: number; price: number; main?: boolean }[]; payerOn: boolean; payerName: string; payerContact: string },
): Promise<Result> {
  const teacher = await me();
  await ownStudent(id, teacher.id);
  const price = p.price && p.price > 0 && p.price < 1_000_000 ? Math.round(p.price) : null;
  const packPrices = (p.packPrices ?? []).filter((x) => [4, 8, 12, 16, 20].includes(x.n) && x.price > 0 && x.price < 10_000_000).map((x) => ({ n: x.n, price: Math.round(x.price), ...(x.main ? { main: true } : {}) }));
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

/** Профиль учителя: имя, часовой пояс, ссылка на звонок по умолчанию. */
export async function updateTeacherProfile(f: { name: string; lastName: string; phone: string; timezone: string; callLink: string }): Promise<{ ok: true } | { ok: false; error: string }> {
  const { t } = await getT();
  const u = await requireUser("TEACHER");
  const name = f.name.trim().slice(0, 80);
  if (!name) return { ok: false, error: t("auth.err.name") };
  const link = f.callLink.trim().slice(0, 500);
  if (link && !/^https?:\/\//.test(link)) return { ok: false, error: t("tp.err.link") };
  await db.user.update({ where: { id: u.id }, data: { name, lastName: f.lastName.trim().slice(0, 80) || null, phone: f.phone.trim().slice(0, 40) || null, timezone: f.timezone || u.timezone } });
  await db.teacherProfile.update({ where: { userId: u.id }, data: { callLink: link || null } });
  revalidatePath("/teacher", "layout");
  return { ok: true };
}

/** Одно поле анкеты — правка прямо в карточке (сохраняется при уходе с поля). */
export async function setStudentField(id: string, key: string, value: string): Promise<Result> {
  const { t } = await getT();
  const teacher = await me();
  const s = await ownStudent(id, teacher.id);
  const v = value.trim();
  const day = (x: string) => (/^\d{4}-\d{2}-\d{2}$/.test(x) ? new Date(x + "T12:00:00Z") : null);
  const form = (patch: object) => ({ form: { ...((s.form as object) ?? {}), ...patch } });
  let data: Record<string, unknown>;
  switch (key) {
    case "name": if (!v) return { ok: false, error: t("auth.err.name") }; data = { name: v.slice(0, 80) }; break;
    case "lastName": data = { lastName: v.slice(0, 80) || null }; break;
    case "email": if (v && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) return { ok: false, error: t("auth.err.email") }; data = { email: v.toLowerCase().slice(0, 200) || null }; break;
    case "telegram": data = { telegram: v ? "@" + v.replace(/^@|^https?:\/\/t\.me\//, "").slice(0, 40) : null }; break;
    case "callLink": if (v && !/^https?:\/\//.test(v)) return { ok: false, error: t("tp.err.link") }; data = { callLink: v.slice(0, 500) || null }; break;
    case "timezone": data = { timezone: v || "Europe/Moscow" }; break;
    case "level": data = { level: v.slice(0, 60) || null }; break;
    case "interests": data = { interests: v.slice(0, 300) || null }; break;
    case "examGoal": data = { examGoal: v.slice(0, 120) || null }; break;
    case "source": data = { source: v.slice(0, 120) || null }; break;
    case "birthday": data = { birthday: day(v) }; break;
    case "startedAt": data = { startedAt: day(v) }; break;
    case "course": {
      const c = v ? await db.course.findUnique({ where: { id: v } }) : null;
      if (c && c.teacherId !== teacher.id) return { ok: false, error: "not found" };
      data = { courseId: c?.id ?? null, course: c?.title ?? null };
      break;
    }
    case "phone": data = form({ phone: v.slice(0, 40) || null }); break;
    case "vk": data = form({ vk: v.slice(0, 120) || null }); break;
    default: return { ok: false, error: "field" };
  }
  await db.student.update({ where: { id }, data });
  refresh(id);
  return { ok: true };
}
