"use server";
import { revalidatePath } from "next/cache";
import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { db } from "../db";
import { requireUser } from "../auth/session";
import { getT } from "../i18n/server";
import { isType, type TaskType } from "../tasks/catalog";
import { parse } from "../tasks/parse";
import { saveTask } from "../teacher/courses";
import { aiCode, aiCtx } from "./ctx";
import { run } from "./gateway";
import { sameAnswer } from "./lite";
import type { Check, DraftTask, Turn } from "./tasks";
import { notify } from "../notify";

type Ok<T> = ({ ok: true } & T) | { ok: false; error: string };
const str = (v: unknown, max = 2000) => (typeof v === "string" ? v.trim().slice(0, max) : "");

async function fail(e: unknown): Promise<{ ok: false; error: string }> {
  const { t } = await getT();
  return { ok: false, error: t(`ai.err.${aiCode(e)}`) };
}

/** Задание доступно: учителю — своё, ученику — задание его преподавателя. */
async function taskFor(taskId: string) {
  const user = await requireUser();
  const task = await db.task.findUnique({ where: { id: taskId }, include: { template: { include: { unit: { include: { course: true } } } } } });
  if (!task) throw new Error("not found");
  const owner = task.template.unit.course.teacherId;
  let level: string | null = null;
  if (user.role === "TEACHER") { if (owner !== user.id) throw new Error("not found"); }
  else {
    const s = await db.student.findUnique({ where: { userId: user.id } });
    if (!s || s.teacherId !== owner) throw new Error("not found");
    level = s.level;
  }
  return { user, task, level };
}

// ───────── Конструктор ─────────

/** «Помочь с ИИ»: дописать или придумать содержание задания в нужной разметке. */
export async function helpTask(lessonId: string, input: { type: string; title: string; content: string }): Promise<Ok<{ content: string }>> {
  const user = await requireUser("TEACHER");
  if (!isType(input.type)) return { ok: false, error: "type" };
  const l = await db.lessonTemplate.findUnique({ where: { id: lessonId }, include: { unit: { include: { course: true } } } });
  if (!l || l.unit.course.teacherId !== user.id) return { ok: false, error: "not found" };
  try {
    const r = await run("help", { type: input.type as TaskType, title: str(input.title, 300), content: str(input.content, 12000), lesson: `${l.unit.course.title} · ${l.title}${l.subtitle ? ` · ${l.subtitle}` : ""}`, level: l.unit.course.level ?? undefined }, await aiCtx(user));
    return { ok: true, content: r.content };
  } catch (e) { return fail(e); }
}

/** «Из файла» внутри задания: распознанный текст → содержание этого задания. */
export async function fileToTask(type: string, text: string): Promise<Ok<{ content: string }>> {
  const user = await requireUser("TEACHER");
  if (!isType(type)) return { ok: false, error: "type" };
  if (!text.trim()) { const { t } = await getT(); return { ok: false, error: t("ai.err.empty") }; }
  try { return { ok: true, ...(await run("file", { type: type as TaskType, text: text.slice(0, 30000) }, await aiCtx(user))) }; }
  catch (e) { return fail(e); }
}

/** «Импорт»: текст из файла → несколько заданий (черновик, учитель выбирает, что добавить). */
export async function splitToTasks(text: string): Promise<Ok<{ tasks: DraftTask[] }>> {
  const user = await requireUser("TEACHER");
  if (!text.trim()) { const { t } = await getT(); return { ok: false, error: t("ai.err.empty") }; }
  try { return { ok: true, ...(await run("split", { text: text.slice(0, 40000) }, await aiCtx(user))) }; }
  catch (e) { return fail(e); }
}

export async function addDraftTasks(lessonId: string, section: "lesson" | "homework" | "words", rubricId: string | null, tasks: DraftTask[]): Promise<Ok<{ n: number }>> {
  // готовый JSON с этапами («part») и разделами («section»): этап ищем среди рубрик урока по названию, нет — добавляем новую
  const withParts = tasks.some((x) => x.part || (x.section && x.section !== "lesson"));
  let rubricOf = (_x: DraftTask): string | null => rubricId;
  let secOf = (_x: DraftTask) => section;
  if (withParts) {
    const user = await requireUser("TEACHER");
    const l = await db.lessonTemplate.findUnique({ where: { id: lessonId }, include: { unit: { include: { course: true } } } });
    if (!l || l.unit.course.teacherId !== user.id) return { ok: false, error: "not found" };
    const secs = [...((l.sections ?? []) as { id: string; title: string }[])];
    // урок пустой и в нём одна рубрика по умолчанию — она становится первым этапом из файла
    let spare = secs.length === 1 && !(await db.task.count({ where: { templateId: lessonId, section: "lesson" } })) ? secs[0] : null;
    for (const part of [...new Set(tasks.filter((x) => (x.section ?? "lesson") === "lesson").map((x) => str(x.part, 80)).filter(Boolean))]) {
      const same = secs.find((r) => r.title.trim().toLowerCase() === part.toLowerCase());
      if (same) { if (same === spare) spare = null; continue; }
      if (spare) { spare.title = part; spare = null; continue; }
      secs.push({ id: randomUUID(), title: part });
    }
    await db.lessonTemplate.update({ where: { id: lessonId }, data: { sections: secs } });
    secOf = (x) => (x.section === "homework" || x.section === "words" ? x.section : x.section === "lesson" || x.part ? "lesson" : section);
    rubricOf = (x) => (secOf(x) !== "lesson" ? null : secs.find((r) => r.title.trim().toLowerCase() === str(x.part, 80).toLowerCase())?.id ?? rubricId ?? secs[0]?.id ?? null);
  }
  let n = 0;
  for (const x of tasks.slice(0, 80)) {
    if (!isType(x.type)) continue;
    const r = await saveTask(lessonId, null, { section: secOf(x), rubricId: rubricOf(x), type: x.type, title: x.title, content: x.content, options: x.teacherOnly ? { teacherOnly: true } : {} });
    if (r.ok) n++;
  }
  return { ok: true, n };
}

/** «Из учебника»: файлы с ролями → план курса (юниты, уроки, задания) для проверки урок за уроком. */
export async function bookPlan(files: { role: string; name: string; text: string }[]): Promise<Ok<{ units: { title: string; lessons: { title: string; tasks: DraftTask[] }[] }[] }>> {
  const user = await requireUser("TEACHER");
  const list = files.filter((f) => f.text?.trim()).slice(0, 10).map((f) => ({ role: ["student", "workbook", "teacher"].includes(f.role) ? f.role : "student", text: f.text.slice(0, 400000) }));
  if (!list.length) { const { t } = await getT(); return { ok: false, error: t("ai.err.empty") }; }
  try {
    const ctx = await aiCtx(user);
    // Большой учебник — по юнитам: каждый кусок отдельно (и кэшируется отдельно).
    const chunks = splitUnits(list);
    const units: { title: string; lessons: { title: string; tasks: DraftTask[] }[] }[] = [];
    for (const c of chunks.slice(0, 30)) units.push(...(await run("book", { files: c }, ctx)).units);
    return { ok: true, units };
  } catch (e) { return fail(e); }
}

function splitUnits(files: { role: string; text: string }[]) {
  const RE = /^(?=\s*(?:Unit|Module|Юнит|Раздел)\s+\d+)/im;
  const per: Record<string, Record<string, string>> = {};
  for (const f of files) for (const part of f.text.split(RE)) {
    const n = part.match(/^\s*(?:Unit|Module|Юнит|Раздел)\s+(\d+)/i)?.[1] ?? "0";
    (per[n] ??= {})[f.role] = ((per[n][f.role] ?? "") + "\n" + part).trim();
  }
  const keys = Object.keys(per).sort((a, b) => Number(a) - Number(b));
  const real = keys.filter((k) => k !== "0");
  if (!real.length) return [files];
  if (per["0"]?.student?.trim()) per[real[0]].student = `${per["0"].student}\n${per[real[0]].student ?? ""}`;
  return real.map((k) => Object.entries(per[k]).map(([role, text]) => ({ role, text })));
}

export async function bookCreate(plan: { units: { title: string; lessons: { title: string; tasks: DraftTask[] }[] }[] }, f: { courseId?: string; title?: string; level?: string; category?: string }): Promise<Ok<{ id: string; firstLesson: string | null }>> {
  const user = await requireUser("TEACHER");
  const { t } = await getT();
  let courseId = f.courseId;
  if (courseId) {
    const c = await db.course.findUnique({ where: { id: courseId } });
    if (!c || c.teacherId !== user.id) return { ok: false, error: "not found" };
  } else {
    const title = str(f.title, 120);
    if (!title) return { ok: false, error: t("crs.err.title") };
    const order = await db.course.count({ where: { teacherId: user.id } });
    courseId = (await db.course.create({ data: { teacherId: user.id, title, level: str(f.level, 40) || null, category: f.category || "general", order, color: order % 6 } })).id;
  }
  let uo = await db.unit.count({ where: { courseId } });
  let first: string | null = null;
  for (const u of plan.units.slice(0, 40)) {
    const unit = await db.unit.create({ data: { courseId, title: str(u.title, 120) || `Unit ${uo + 1}`, order: uo++ } });
    let lo = 0;
    for (const l of u.lessons.slice(0, 20)) {
      const tasks = l.tasks.filter((x) => isType(x.type)).slice(0, 80);
      // этапы урока: из «part» готового JSON (по порядку появления), иначе одна рубрика Lead-in
      const parts = [...new Set(tasks.filter((x) => (x.section ?? "lesson") === "lesson").map((x) => str(x.part, 80)).filter(Boolean))];
      const secs = (parts.length ? parts : ["Lead-in"]).map((title) => ({ id: randomUUID(), title }));
      const rubricOf = (x: DraftTask) => secs.find((r) => r.title === str(x.part, 80))?.id ?? secs[0].id;
      const lesson = await db.lessonTemplate.create({ data: { unitId: unit.id, title: str(l.title, 160) || `Lesson ${lo + 1}`, order: lo++, sections: secs } });
      first ??= lesson.id;
      const order: Record<string, number> = {};
      if (tasks.length)
        await db.task.createMany({
          data: tasks.map((x) => {
            const section = x.section === "homework" || x.section === "words" ? x.section : "lesson";
            order[section] = (order[section] ?? -1) + 1;
            return { templateId: lesson.id, section, rubricId: section === "lesson" ? rubricOf(x) : null, type: x.type, title: str(x.title, 300), content: String(x.content ?? "").slice(0, 50000), options: (x.teacherOnly ? { teacherOnly: true } : {}) as Prisma.InputJsonObject, order: order[section] };
          }),
        });
    }
  }
  revalidatePath("/teacher/courses");
  revalidatePath(`/teacher/courses/${courseId}`);
  return { ok: true, id: courseId, firstLesson: first };
}

// ───────── «Мне непонятно» и вопросы ─────────

/** Ученик спрашивает — сначала отвечает ИИ по правилам задания; вопрос виден учителю во вкладке «Спрашивали ИИ». */
export async function askAi(text: string, context: string, taskId?: string): Promise<Ok<{ id: string; answer: string }>> {
  const user = await requireUser("STUDENT");
  const s = await db.student.findUnique({ where: { userId: user.id } });
  if (!s) return { ok: false, error: "no student" };
  const q = str(text, 2000);
  if (!q) return { ok: false, error: "empty" };
  let task = "";
  if (taskId) {
    const tk = await taskFor(taskId).catch(() => null);
    if (tk) task = `${tk.task.title}\n${tk.task.content.slice(0, 4000)}`;
  }
  try {
    const r = await run("explain", { question: q, task: task || str(context, 300), level: s.level ?? undefined }, await aiCtx(user));
    const row = await db.question.create({ data: { studentId: s.id, taskId: taskId && task ? taskId : null, text: q, context: str(context, 300) || null, aiAnswer: r.answer, askedTeacher: false } });
    revalidatePath("/teacher/questions");
    return { ok: true, id: row.id, answer: r.answer };
  } catch (e) { return fail(e); }
}

/** «Спросить преподавателя» после ответа ИИ (вне урока; в уроке — через класс). */
export async function escalateQuestion(id: string): Promise<Ok<object>> {
  const user = await requireUser("STUDENT");
  const q = await db.question.findUnique({ where: { id }, include: { student: true } });
  if (!q || q.student.userId !== user.id) return { ok: false, error: "not found" };
  await db.question.update({ where: { id }, data: { askedTeacher: true } });
  await notify({ userId: q.student.teacherId, kind: "question", title: `${q.student.name}: ${q.text.slice(0, 120)}`, action: "reply", link: "/teacher/questions" });
  revalidatePath("/student/questions");
  revalidatePath("/teacher/questions");
  return { ok: true };
}

/** Черновик ответа учителя на вопрос ученика. */
export async function draftAnswer(id: string): Promise<Ok<{ answer: string }>> {
  const user = await requireUser("TEACHER");
  const q = await db.question.findUnique({ where: { id }, include: { student: true, task: true } });
  if (!q || q.student.teacherId !== user.id) return { ok: false, error: "not found" };
  try {
    const r = await run("draft", { question: q.text, context: [q.context, q.task?.title, q.task?.content.slice(0, 2000)].filter(Boolean).join("\n"), ai: q.aiAnswer ?? undefined }, { ...(await aiCtx(user)), names: [q.student.name, q.student.lastName, user.name] });
    return { ok: true, answer: r.answer };
  } catch (e) { return fail(e); }
}

// ───────── Проверка ответов ─────────

function answerText(type: string, content: string, payload: Record<string, unknown>) {
  const p = parse(type as TaskType, content);
  if (type === "essay") return { text: String(payload.text ?? ""), task: content, expected: undefined };
  if (type === "record") { const r = payload.rec as { transcript?: string } | undefined; return { text: r?.transcript ?? "", task: content, expected: undefined }; }
  const val = (payload.val ?? {}) as Record<number, string>;
  if (p.kind === "pairsArrow") {
    const items = p.items.map((it, i) => ({ ...it, a: (val[i] ?? "").trim() }));
    return {
      text: items.map((it, i) => `${i + 1}. ${it.q}${it.key ? ` (${it.key})` : ""} → ${it.a || "—"}`).join("\n"),
      expected: items.map((it, i) => `${i + 1}. ${it.answers.join(" / ")}`).join("\n"),
      task: content, items,
    };
  }
  if (p.kind === "lines") return { text: p.items.map((q, i) => `${i + 1}. ${q}\n→ ${(val[i] ?? "").trim() || "—"}`).join("\n"), task: content, expected: undefined };
  return { text: JSON.stringify(payload).slice(0, 4000), task: content, expected: undefined };
}

/** «Проверить с ИИ» у учителя: эссе, открытые ответы, перефразирование и перевод (альтернативные ответы), запись. Результат — черновик, ученик увидит его только после «ОК, показать ученику». */
export async function checkAnswer(lessonInstanceId: string, taskId: string): Promise<Ok<{ check: Check }>> {
  const user = await requireUser("TEACHER");
  const lesson = await db.lessonInstance.findUnique({ where: { id: lessonInstanceId }, include: { student: true } });
  if (!lesson || lesson.teacherId !== user.id || !lesson.studentId) return { ok: false, error: "not found" };
  const task = await db.task.findUnique({ where: { id: taskId } });
  if (!task || task.templateId !== lesson.templateId) return { ok: false, error: "not found" };
  const ans = await db.answer.findUnique({ where: { lessonInstanceId_taskId_studentId: { lessonInstanceId, taskId, studentId: lesson.studentId } } });
  const payload = (ans?.payload ?? {}) as Record<string, unknown>;
  const a = answerText(task.type, `${task.title}\n${task.content}`, payload);
  const { t } = await getT();
  if (!a.text.replace(/[\d.\s→—-]/g, "")) return { ok: false, error: t("ai.err.noAnswer") };
  const ctx = { ...(await aiCtx(user)), names: [lesson.student?.name, lesson.student?.lastName, user.name] };
  try {
    let check: Check;
    if (task.type === "essay") check = await run("essay", { task: a.task, text: a.text, level: lesson.student?.level ?? undefined, limit: (task.options as { limitWords?: number })?.limitWords }, ctx);
    else if (task.type === "record") check = await run("speech", { task: a.task, text: a.text }, ctx);
    else if ("items" in a && a.items) {
      // простые совпадения — кодом, без ИИ; остальное — ИИ оценивает альтернативные ответы
      const rest = a.items.filter((it) => it.a && !it.answers.some((x) => sameAnswer(x, it.a)));
      if (!rest.length) check = { corrected: a.text, notes: [], summary: t("ai.allMatch"), verdict: a.items.every((it) => it.a) ? "ok" : "partly" };
      else check = await run("precheck", { task: a.task, text: a.text, expected: a.expected }, ctx);
    } else check = await run("precheck", { task: a.task, text: a.text }, ctx);
    const draft = { ...check, source: a.text, at: new Date().toISOString() };
    await db.answer.upsert({
      where: { lessonInstanceId_taskId_studentId: { lessonInstanceId, taskId, studentId: lesson.studentId } },
      create: { lessonInstanceId, taskId, studentId: lesson.studentId, payload: {}, status: "NEEDS_REVIEW", aiDraft: draft as Prisma.InputJsonObject },
      update: { aiDraft: draft as Prisma.InputJsonObject },
    });
    return { ok: true, check: draft };
  } catch (e) { return fail(e); }
}

// ───────── Речь ─────────

/** ИИ-собеседник: следующая реплика. */
export async function partnerReply(taskId: string, history: Turn[]): Promise<Ok<{ reply: string }>> {
  try {
    const { user, task, level } = await taskFor(taskId);
    const o = (task.options ?? {}) as { aiPrompt?: string; aiGoal?: string; aiWords?: string };
    const h = history.slice(-20).map((x) => ({ role: x.role === "assistant" ? "assistant" as const : "user" as const, text: str(x.text, 1500) })).filter((x) => x.text);
    const r = await run("partner", { history: h, prompt: o.aiPrompt, goal: o.aiGoal, words: o.aiWords, questions: task.content.slice(0, 2000), level: level ?? undefined }, await aiCtx(user));
    return { ok: true, reply: r.reply };
  } catch (e) { return fail(e); }
}

/** Запись аудио: расшифровка → исправленная версия (видит ученик сразу). */
export async function fixSpeech(taskId: string, transcript: string): Promise<Ok<{ check: Check }>> {
  try {
    const { user, task } = await taskFor(taskId);
    const text = str(transcript, 8000);
    if (!text) { const { t } = await getT(); return { ok: false, error: t("ai.err.noAnswer") }; }
    return { ok: true, check: await run("speech", { task: `${task.title}\n${task.content}`.slice(0, 3000), text }, await aiCtx(user)) };
  } catch (e) { return fail(e); }
}
