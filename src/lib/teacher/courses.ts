"use server";
import { cleanTitle } from "../tasks/import-json";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { db } from "../db";
import { requireUser } from "../auth/session";
import { randomToken } from "../auth/crypto";
import { getT } from "../i18n/server";
import { COURSE_CATEGORIES, isType, PRESET, SAMPLE, type Rubric, type TaskOptions, type TaskType } from "../tasks/catalog";
import { cleanInfo, type TInfo } from "../tasks/teacher-info";

export type R = { ok: true; id?: string; token?: string } | { ok: false; error: string };
const clean = (v: unknown, max = 200) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const me = () => requireUser("TEACHER");

async function ownCourse(id: string, tid: string) {
  const c = await db.course.findUnique({ where: { id } });
  if (!c || c.teacherId !== tid) throw new Error("not found");
  return c;
}
async function ownUnit(id: string, tid: string) {
  const u = await db.unit.findUnique({ where: { id }, include: { course: true } });
  if (!u || u.course.teacherId !== tid) throw new Error("not found");
  return u;
}
async function ownLesson(id: string, tid: string) {
  const l = await db.lessonTemplate.findUnique({ where: { id }, include: { unit: { include: { course: true } } } });
  if (!l || l.unit.course.teacherId !== tid) throw new Error("not found");
  return l;
}
async function ownTask(id: string, tid: string) {
  const t = await db.task.findUnique({ where: { id }, include: { template: { include: { unit: { include: { course: true } } } } } });
  if (!t || t.template.unit.course.teacherId !== tid) throw new Error("not found");
  return t;
}
const refreshBuilder = (lessonId: string) => revalidatePath(`/builder/${lessonId}`);
const refreshCourse = (courseId: string) => { revalidatePath("/teacher/courses"); revalidatePath(`/teacher/courses/${courseId}`); };

// ───────── Курсы ─────────

export async function createCourse(f: { title: string; level: string; category: string }): Promise<R> {
  const { t } = await getT();
  const teacher = await me();
  const title = clean(f.title, 120);
  if (!title) return { ok: false, error: t("crs.err.title") };
  const category = COURSE_CATEGORIES.some((c) => c[0] === f.category) ? f.category : "general";
  const order = await db.course.count({ where: { teacherId: teacher.id } });
  const course = await db.course.create({
    data: {
      teacherId: teacher.id, title, level: clean(f.level, 40) || null, category, order, color: order % 6,
      units: { create: { title: "Unit 1", order: 0, lessons: { create: { title: "Lesson 1", order: 0, sections: [{ id: randomUUID(), title: "Lead-in" }] } } } },
    },
  });
  revalidatePath("/teacher/courses");
  return { ok: true, id: course.id };
}

export async function updateCourse(id: string, f: { title?: string; level?: string; category?: string; cover?: string | null; audience?: string }): Promise<R> {
  const teacher = await me();
  const c = await ownCourse(id, teacher.id);
  await db.course.update({
    where: { id },
    data: {
      title: f.title !== undefined ? clean(f.title, 120) || c.title : undefined,
      level: f.level !== undefined ? clean(f.level, 40) || null : undefined,
      category: f.category && COURSE_CATEGORIES.some((x) => x[0] === f.category) ? f.category : undefined,
      cover: f.cover !== undefined ? (f.cover && f.cover.startsWith("/api/files/") ? f.cover : null) : undefined,
      audience: f.audience !== undefined ? clean(f.audience, 120) || null : undefined,
    },
  });
  refreshCourse(id);
  return { ok: true };
}

export async function deleteCourse(id: string): Promise<never> {
  const teacher = await me();
  await ownCourse(id, teacher.id);
  await db.course.delete({ where: { id } });
  revalidatePath("/teacher/courses");
  redirect("/teacher/courses");
}

/** Порядок курсов внутри раздела (и перенос в другой раздел). */
export async function reorderCourses(category: string, ids: string[]): Promise<R> {
  const teacher = await me();
  const own = await db.course.findMany({ where: { id: { in: ids }, teacherId: teacher.id }, select: { id: true } });
  if (own.length !== ids.length) return { ok: false, error: "not found" };
  await db.$transaction(ids.map((id, i) => db.course.update({ where: { id }, data: { order: i, category } })));
  revalidatePath("/teacher/courses");
  return { ok: true };
}

/** Порядок разделов на странице «Курсы» (хранится в настройках учителя). */
export async function reorderCategories(keys: string[]): Promise<R> {
  const teacher = await me();
  const prof = await db.teacherProfile.findUnique({ where: { userId: teacher.id } });
  const settings = { ...((prof?.settings as object) ?? {}), categoryOrder: keys.filter((k) => COURSE_CATEGORIES.some((c) => c[0] === k)) };
  await db.teacherProfile.update({ where: { userId: teacher.id }, data: { settings } });
  revalidatePath("/teacher/courses");
  return { ok: true };
}

// ───────── Юниты ─────────

export async function createUnit(courseId: string, title: string): Promise<R> {
  const teacher = await me();
  await ownCourse(courseId, teacher.id);
  const n = await db.unit.count({ where: { courseId } });
  const u = await db.unit.create({ data: { courseId, title: clean(title, 120) || `Unit ${n + 1}`, order: n } });
  refreshCourse(courseId);
  return { ok: true, id: u.id };
}

export async function updateUnit(id: string, f: { title?: string; collapsed?: boolean; outcomes?: string[] }): Promise<R> {
  const teacher = await me();
  const u = await ownUnit(id, teacher.id);
  await db.unit.update({
    where: { id },
    data: { title: f.title !== undefined ? clean(f.title, 120) || u.title : undefined, collapsed: f.collapsed, outcomes: f.outcomes?.map((x) => clean(x, 200)).filter(Boolean) },
  });
  refreshCourse(u.courseId);
  return { ok: true };
}

export async function deleteUnit(id: string): Promise<R> {
  const teacher = await me();
  const u = await ownUnit(id, teacher.id);
  await db.unit.delete({ where: { id } });
  refreshCourse(u.courseId);
  return { ok: true };
}

export async function reorderUnits(courseId: string, ids: string[]): Promise<R> {
  const teacher = await me();
  await ownCourse(courseId, teacher.id);
  const own = await db.unit.count({ where: { id: { in: ids }, courseId } });
  if (own !== ids.length) return { ok: false, error: "not found" };
  await db.$transaction(ids.map((id, i) => db.unit.update({ where: { id }, data: { order: i } })));
  refreshCourse(courseId);
  return { ok: true };
}

// ───────── Уроки (шаблоны) ─────────

export async function createLessonTemplate(unitId: string, title: string): Promise<R> {
  const teacher = await me();
  const u = await ownUnit(unitId, teacher.id);
  const n = await db.lessonTemplate.count({ where: { unitId } });
  const l = await db.lessonTemplate.create({ data: { unitId, title: clean(title, 160) || `Lesson ${n + 1}`, order: n, sections: [{ id: randomUUID(), title: "Lead-in" }] } });
  refreshCourse(u.courseId);
  return { ok: true, id: l.id };
}

/** Блок «Для учителя» (lesson info, aims, overview, заметки) — ученику не показывается. */
export async function updateTeacherInfo(id: string, info: TInfo): Promise<R> {
  const teacher = await me();
  await ownLesson(id, teacher.id);
  await db.lessonTemplate.update({ where: { id }, data: { teacherInfo: cleanInfo(info) as Prisma.InputJsonObject } });
  revalidatePath(`/builder/${id}`);
  return { ok: true };
}

export async function updateLessonMeta(id: string, f: { title?: string; subtitle?: string; durationMin?: number; outcomes?: string[] }): Promise<R> {
  const teacher = await me();
  const l = await ownLesson(id, teacher.id);
  await db.lessonTemplate.update({
    where: { id },
    data: {
      title: f.title !== undefined ? clean(f.title, 160) || l.title : undefined,
      subtitle: f.subtitle !== undefined ? clean(f.subtitle, 160) || null : undefined,
      durationMin: f.durationMin && [30, 45, 60, 90, 120].includes(f.durationMin) ? f.durationMin : undefined,
      outcomes: f.outcomes?.map((x) => clean(x, 200)).filter(Boolean).slice(0, 20),
    },
  });
  refreshCourse(l.unit.courseId);
  revalidatePath(`/teacher/builder/${id}`);
  return { ok: true };
}

export async function deleteLessonTemplate(id: string): Promise<R> {
  const teacher = await me();
  const l = await ownLesson(id, teacher.id);
  await db.lessonTemplate.delete({ where: { id } });
  refreshCourse(l.unit.courseId);
  return { ok: true };
}

/** Перестановка уроков; урок можно перенести в другой юнит того же курса. */
export async function placeLessons(unitId: string, ids: string[]): Promise<R> {
  const teacher = await me();
  const u = await ownUnit(unitId, teacher.id);
  const own = await db.lessonTemplate.findMany({ where: { id: { in: ids } }, include: { unit: true } });
  if (own.length !== ids.length || own.some((l) => l.unit.courseId !== u.courseId)) return { ok: false, error: "not found" };
  await db.$transaction(ids.map((id, i) => db.lessonTemplate.update({ where: { id }, data: { order: i, unitId } })));
  refreshCourse(u.courseId);
  return { ok: true };
}

/** Объединить отмеченные уроки в первый: задания переносятся, остальные уроки удаляются. */
export async function mergeLessons(ids: string[]): Promise<R> {
  const teacher = await me();
  if (ids.length < 2) return { ok: false, error: "few" };
  const ls = await Promise.all(ids.map((id) => ownLesson(id, teacher.id)));
  const [first, ...rest] = ls;
  let order = await db.task.count({ where: { templateId: first.id } });
  const rubrics = [...((first.sections as Rubric[]) ?? [])];
  for (const l of rest) {
    for (const r of (l.sections as Rubric[]) ?? []) if (!rubrics.some((x) => x.id === r.id)) rubrics.push(r);
    const tasks = await db.task.findMany({ where: { templateId: l.id }, orderBy: { order: "asc" } });
    for (const t of tasks) await db.task.update({ where: { id: t.id }, data: { templateId: first.id, order: order++ } });
  }
  await db.lessonTemplate.update({ where: { id: first.id }, data: { sections: rubrics, outcomes: [...new Set(ls.flatMap((l) => l.outcomes))] } });
  await db.lessonTemplate.deleteMany({ where: { id: { in: rest.map((l) => l.id) } } });
  refreshCourse(first.unit.courseId);
  return { ok: true, id: first.id };
}

/** Назначить урок ученику: на ближайшее занятие (или выбранное). Курс ученика становится ведущим. */
export async function assignLesson(templateId: string, studentId: string, lessonInstanceId?: string): Promise<R> {
  const { t } = await getT();
  const teacher = await me();
  const l = await ownLesson(templateId, teacher.id);
  const s = await db.student.findUnique({ where: { id: studentId } });
  if (!s || s.teacherId !== teacher.id) return { ok: false, error: "not found" };
  const inst = lessonInstanceId
    ? await db.lessonInstance.findFirst({ where: { id: lessonInstanceId, studentId } })
    : await db.lessonInstance.findFirst({ where: { studentId, status: "PLANNED", startsAt: { gt: new Date(Date.now() - 3600e3) } }, orderBy: { startsAt: "asc" } });
  if (!inst) return { ok: false, error: t("crs.err.noLesson") };
  await db.$transaction([
    db.lessonInstance.update({ where: { id: inst.id }, data: { templateId } }),
    db.student.update({ where: { id: studentId }, data: { courseId: l.unit.courseId, course: l.unit.course.title } }),
  ]);
  revalidatePath("/teacher", "layout");
  return { ok: true, id: inst.id };
}

// ───────── Конструктор: рубрики ─────────

export async function setRubrics(lessonId: string, rubrics: Rubric[]): Promise<R> {
  const teacher = await me();
  await ownLesson(lessonId, teacher.id);
  const list = rubrics.map((r) => ({ id: clean(r.id, 60) || randomUUID(), title: clean(r.title, 60) || "Section" })).slice(0, 30);
  if (!list.length) list.push({ id: randomUUID(), title: "Lead-in" });
  await db.lessonTemplate.update({ where: { id: lessonId }, data: { sections: list } });
  // задания удалённых рубрик переходят в первую
  await db.task.updateMany({ where: { templateId: lessonId, section: "lesson", rubricId: { notIn: list.map((r) => r.id) } }, data: { rubricId: list[0].id } });
  refreshBuilder(lessonId);
  return { ok: true };
}

// ───────── Конструктор: задания ─────────

type TaskInput = { section: "lesson" | "homework" | "words"; rubricId?: string | null; type: string; title: string; content: string; options: TaskOptions };

function sanitizeOptions(o: TaskOptions): Prisma.InputJsonObject {
  const okUrl = (u?: string) => (u && (/^https?:\/\//.test(u) || u.startsWith("/api/files/")) ? u.slice(0, 1000) : undefined);
  return JSON.parse(JSON.stringify({
    hidden: !!o.hidden || undefined, nonum: !!o.nonum || undefined, noreveal: !!o.noreveal || undefined,
    checkMode: o.checkMode === "instant" ? "instant" : o.checkMode === "button" ? "button" : undefined,
    mode: o.mode === "drag" ? "drag" : o.mode === "gap" ? "gap" : undefined,
    split: !!o.split || undefined, seriesSize: o.seriesSize && o.seriesSize > 0 && o.seriesSize < 50 ? Math.round(o.seriesSize) : undefined,
    limitWords: o.limitWords && o.limitWords > 0 ? Math.round(o.limitWords) : undefined,
    limitSec: o.limitSec && o.limitSec > 0 && o.limitSec <= 600 ? Math.round(o.limitSec) : undefined,
    showScript: !!o.showScript || undefined, script: clean(o.script, 20000) || undefined,
    src: okUrl(o.src), url: okUrl(o.url), label: clean(o.label, 200) || undefined,
    images: (o.images ?? []).map((im) => ({ src: okUrl(im.src), caption: clean(im.caption, 300) || undefined })).filter((im) => im.src).slice(0, 30),
    layout: o.layout === "stack" ? "stack" : undefined,
    pics: (o.pics ?? []).map((u) => okUrl(u) ?? "").slice(0, 60),
    ns: !!o.ns || undefined, check: !!o.check || undefined, multi: !!o.multi || undefined, teacherOnly: !!o.teacherOnly || undefined,
    aipre: !!o.aipre || undefined, ai: !!o.ai || undefined, aiPrompt: clean(o.aiPrompt, 500) || undefined, aiGoal: clean(o.aiGoal, 300) || undefined, aiWords: clean(o.aiWords, 500) || undefined,
    aiMins: o.aiMins && o.aiMins > 0 && o.aiMins <= 60 ? Math.round(o.aiMins) : undefined,
    clipStart: o.clipStart && o.clipStart > 0 && o.clipStart < 86400 ? Math.round(o.clipStart) : undefined,
    clipEnd: o.clipEnd && o.clipEnd > (o.clipStart ?? 0) && o.clipEnd < 86400 ? Math.round(o.clipEnd) : undefined,
    markable: !!o.markable || undefined,
    help: o.help && (clean(o.help.vocab, 3000) || clean(o.help.grammar, 3000)) ? { vocab: clean(o.help.vocab, 3000) || undefined, grammar: clean(o.help.grammar, 3000) || undefined } : undefined,
    fixed: Array.isArray(o.fixed) && o.fixed.length ? [...new Set(o.fixed.filter((x) => Number.isInteger(x) && x >= 0 && x < 200))].sort((a, b) => a - b) : undefined,
  }));
}

export async function saveTask(lessonId: string, taskId: string | null, input: TaskInput, index?: number): Promise<R> {
  const teacher = await me();
  await ownLesson(lessonId, teacher.id);
  if (!isType(input.type)) return { ok: false, error: "type" };
  const section = ["lesson", "homework", "words"].includes(input.section) ? input.section : "lesson";
  const data = {
    type: input.type, title: cleanTitle(String(input.title ?? "")), content: typeof input.content === "string" ? input.content.slice(0, 50000) : "",
    options: sanitizeOptions(input.options ?? {}), hidden: !!input.options?.hidden, section, rubricId: section === "lesson" ? input.rubricId ?? null : null,
  };
  if (taskId) {
    const t = await ownTask(taskId, teacher.id);
    if (t.templateId !== lessonId) return { ok: false, error: "not found" };
    await db.task.update({ where: { id: taskId }, data });
    if (t.type !== data.type) await db.answer.deleteMany({ where: { taskId } }); // другой тип — старый ответ не подходит, задание снова не выполнено
    refreshBuilder(lessonId);
    return { ok: true, id: taskId };
  }
  // вставка на позицию index внутри своей секции/рубрики
  const siblings = await db.task.findMany({ where: { templateId: lessonId, section, rubricId: data.rubricId }, orderBy: { order: "asc" }, select: { id: true } });
  const at = index === undefined || index < 0 || index > siblings.length ? siblings.length : index;
  const created = await db.task.create({ data: { ...data, templateId: lessonId, order: at } });
  const ids = [...siblings.map((s) => s.id)];
  ids.splice(at, 0, created.id);
  await db.$transaction(ids.map((id, i) => db.task.update({ where: { id }, data: { order: i } })));
  refreshBuilder(lessonId);
  return { ok: true, id: created.id };
}

export async function deleteTask(id: string): Promise<R> {
  const teacher = await me();
  const t = await ownTask(id, teacher.id);
  await db.task.delete({ where: { id } });
  refreshBuilder(t.templateId);
  return { ok: true };
}

/** Глазик: видит ли задание ученик (закрытый глазик — только учитель). Старое «скрыто» снимается тем же нажатием. */
export async function toggleStudentSees(id: string): Promise<R> {
  const teacher = await me();
  const t = await ownTask(id, teacher.id);
  const o = (t.options ?? {}) as Record<string, unknown>;
  const options = t.hidden ? { ...o, hidden: undefined, teacherOnly: undefined } : { ...o, teacherOnly: o.teacherOnly ? undefined : true };
  await db.task.update({ where: { id }, data: { hidden: false, options: JSON.parse(JSON.stringify(options)) } });
  refreshBuilder(t.templateId);
  return { ok: true };
}

export async function toggleTaskHidden(id: string): Promise<R> {
  const teacher = await me();
  const t = await ownTask(id, teacher.id);
  const options = { ...((t.options as object) ?? {}), hidden: !t.hidden || undefined };
  await db.task.update({ where: { id }, data: { hidden: !t.hidden, options: JSON.parse(JSON.stringify(options)) } });
  refreshBuilder(t.templateId);
  return { ok: true };
}

/** Новый порядок заданий секции; можно перенести задание в другую рубрику или в домашку. */
export async function placeTasks(lessonId: string, section: "lesson" | "homework" | "words", rubricId: string | null, ids: string[]): Promise<R> {
  const teacher = await me();
  await ownLesson(lessonId, teacher.id);
  const own = await db.task.count({ where: { id: { in: ids }, templateId: lessonId } });
  if (own !== ids.length) return { ok: false, error: "not found" };
  await db.$transaction(ids.map((id, i) => db.task.update({ where: { id }, data: { order: i, section, rubricId: section === "lesson" ? rubricId : null } })));
  refreshBuilder(lessonId);
  return { ok: true };
}

/** Новое задание выбранного типа с готовой формулировкой и примером содержания. */
export async function addTaskOfType(lessonId: string, section: "lesson" | "homework" | "words", rubricId: string | null, type: TaskType, index?: number): Promise<R> {
  return saveTask(lessonId, null, { section, rubricId, type, title: PRESET[type]?.[0] ?? "", content: SAMPLE[type] ?? "", options: type === "drag" ? { mode: "drag" } : {} }, index);
}

// ───────── Поделиться ─────────

export async function setShare(lessonId: string, on: boolean): Promise<R> {
  const teacher = await me();
  const l = await ownLesson(lessonId, teacher.id);
  const token = l.shareToken ?? randomToken(16);
  await db.lessonTemplate.update({ where: { id: lessonId }, data: { shareOn: on, shareToken: token } });
  refreshBuilder(lessonId);
  return { ok: true, token };
}

/** Новая ссылка — старая перестаёт работать. */
export async function resetShare(lessonId: string): Promise<R> {
  const teacher = await me();
  await ownLesson(lessonId, teacher.id);
  const token = randomToken(16);
  await db.lessonTemplate.update({ where: { id: lessonId }, data: { shareToken: token, shareOn: true } });
  refreshBuilder(lessonId);
  return { ok: true, token };
}

// ───────── Избранные типы заданий ─────────

export async function setFavourites(types: string[]): Promise<R> {
  const teacher = await me();
  const prof = await db.teacherProfile.findUnique({ where: { userId: teacher.id } });
  const settings = { ...((prof?.settings as object) ?? {}), favTypes: types.filter(isType).slice(0, 30) };
  await db.teacherProfile.update({ where: { userId: teacher.id }, data: { settings } });
  return { ok: true };
}
