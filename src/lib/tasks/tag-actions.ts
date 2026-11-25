"use server";
// Разметка заданий ИИ: тема из справочника, навык, уровень, темы пунктов, ловушки, слова и формулировка с темой.
// Учитель видит метку чипом в конструкторе и правит; поставленное учителем ИИ не перезаписывает.
import { revalidatePath } from "next/cache";
import type { Prisma } from "@prisma/client";
import { db } from "../db";
import { requireUser } from "../auth/session";
import { getT } from "../i18n/server";
import { llmFor } from "../ai/gateway";
import { modelsFor } from "../ai/models";
import { prompt } from "../ai/prompts";
import { runJson } from "../ai/route-core";
import { aiCode, aiCtx } from "../ai/ctx";
import { catalogFor, cleanTags, type TaskTags } from "./tags";

type R<T = object> = ({ ok: true } & T) | { ok: false; error: string };
const SKIP = new Set(["divider", "image", "audio", "video", "link", "note", "info"]);

function cleanOut(raw: Record<string, unknown>) {
  const xs = Array.isArray(raw.tasks) ? raw.tasks as Record<string, unknown>[] : [];
  if (!xs.length) throw new Error("tags: empty");
  return xs.map((x) => ({ n: Number(x.n), tags: cleanTags({ ...x, by: "ai" }), title: typeof x.title === "string" ? x.title.trim().slice(0, 400) : "" }));
}

async function tagBatch(me: { id: string }, lesson: { course: string; title: string; level: string | null }, tasks: { n: number; type: string; title: string; content: string }[]) {
  const input = { lesson, catalog: catalogFor(lesson.level), tasks: tasks.map((x) => ({ ...x, content: x.content.slice(0, 1500) })) };
  const run = await runJson(llmFor("route", await aiCtx(me as never)), modelsFor("route"), prompt("task-tags"), input, cleanOut, { tag: "task-tags", maxTokens: 4000, temperature: 0.1 });
  return run.data;
}

/** Метка для одного задания в редакторе (не сохраняет — учитель сохраняет задание сам). */
export async function tagDraft(lessonId: string, task: { type: string; title: string; content: string }): Promise<R<{ tags: TaskTags | null }>> {
  const me = await requireUser("TEACHER");
  const { t } = await getT();
  const l = await db.lessonTemplate.findUnique({ where: { id: lessonId }, include: { unit: { include: { course: true } } } });
  if (!l || l.unit.course.teacherId !== me.id) return { ok: false, error: "not found" };
  try {
    const [x] = await tagBatch(me, { course: l.unit.course.title, title: l.title, level: l.unit.course.level }, [{ n: 1, ...task }]);
    const hint = x?.title && x.title !== task.title.trim() ? x.title : undefined;
    return { ok: true, tags: x?.tags ? { ...x.tags, ...(hint ? { hint } : {}) } : null };
  } catch (e) { return { ok: false, error: t(`ai.err.${aiCode(e)}`) }; }
}

/** «Разметить темы» для урока: задания без метки (или все, кроме поставленных учителем), пачками по 10. */
export async function tagLesson(lessonId: string, all = false): Promise<R<{ n: number }>> {
  const me = await requireUser("TEACHER");
  const { t } = await getT();
  const l = await db.lessonTemplate.findUnique({ where: { id: lessonId }, include: { unit: { include: { course: true } }, tasks: { orderBy: { order: "asc" } } } });
  if (!l || l.unit.course.teacherId !== me.id) return { ok: false, error: "not found" };
  const todo = l.tasks.filter((x) => {
    if (SKIP.has(x.type)) return false;
    const tg = ((x.options ?? {}) as { tags?: TaskTags }).tags;
    return all ? tg?.by !== "teacher" : !tg;
  });
  let n = 0;
  try {
    for (let i = 0; i < todo.length; i += 10) {
      const part = todo.slice(i, i + 10);
      const out = await tagBatch(me, { course: l.unit.course.title, title: l.title, level: l.unit.course.level }, part.map((x, k) => ({ n: k + 1, type: x.type, title: x.title, content: x.content })));
      for (const o of out) {
        const task = part[o.n - 1];
        if (!task || !o.tags) continue;
        const hint = o.title && o.title !== task.title.trim() ? o.title : undefined;
        const opts = { ...((task.options ?? {}) as object), tags: { ...o.tags, ...(hint ? { hint } : {}) } };
        await db.task.update({ where: { id: task.id }, data: { options: JSON.parse(JSON.stringify(opts)) as Prisma.InputJsonValue } });
        n++;
      }
    }
  } catch (e) { if (!n) return { ok: false, error: t(`ai.err.${aiCode(e)}`) }; }
  revalidatePath(`/builder/${lessonId}`);
  return { ok: true, n };
}

/** Разметить весь курс (уже созданные уроки) — по урокам. */
export async function tagCourse(courseId: string): Promise<R<{ n: number }>> {
  const me = await requireUser("TEACHER");
  const c = await db.course.findUnique({ where: { id: courseId }, include: { units: { include: { lessons: { select: { id: true } } } } } });
  if (!c || c.teacherId !== me.id) return { ok: false, error: "not found" };
  let n = 0;
  for (const u of c.units) for (const l of u.lessons) { const r = await tagLesson(l.id); if (r.ok) n += r.n; }
  revalidatePath(`/teacher/courses/${courseId}`);
  return { ok: true, n };
}
