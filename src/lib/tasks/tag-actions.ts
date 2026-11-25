"use server";
// Разметка заданий ИИ: тема из справочника, навык, уровень, темы пунктов, ловушки, слова и формулировка с темой.
// Учитель видит метку чипом в конструкторе и правит; поставленное учителем ИИ не перезаписывает.
import { revalidatePath } from "next/cache";
import { db } from "../db";
import { requireUser } from "../auth/session";
import { getT } from "../i18n/server";
import { aiCode, aiCtx } from "../ai/ctx";
import type { TaskTags } from "./tags";
import { tagBatch, tagTemplate } from "./tagging";

type R<T = object> = ({ ok: true } & T) | { ok: false; error: string };

/** Метка для одного задания в редакторе (не сохраняет — учитель сохраняет задание сам). */
export async function tagDraft(lessonId: string, task: { type: string; title: string; content: string }): Promise<R<{ tags: TaskTags | null }>> {
  const me = await requireUser("TEACHER");
  const { t } = await getT();
  const l = await db.lessonTemplate.findUnique({ where: { id: lessonId }, include: { unit: { include: { course: true } } } });
  if (!l || l.unit.course.teacherId !== me.id) return { ok: false, error: "not found" };
  try {
    const [x] = await tagBatch(await aiCtx(me), { course: l.unit.course.title, title: l.title, level: l.unit.course.level }, [{ n: 1, ...task }]);
    const hint = x?.title && x.title !== task.title.trim() ? x.title : undefined;
    return { ok: true, tags: x?.tags ? { ...x.tags, ...(hint ? { hint } : {}) } : null };
  } catch (e) { return { ok: false, error: t(`ai.err.${aiCode(e)}`) }; }
}

/** «Разметить темы» для урока: задания без метки (или все, кроме поставленных учителем), пачками по 10. */
export async function tagLesson(lessonId: string, all = false): Promise<R<{ n: number }>> {
  const me = await requireUser("TEACHER");
  const { t } = await getT();
  const l = await db.lessonTemplate.findUnique({ where: { id: lessonId }, include: { unit: { include: { course: true } } } });
  if (!l || l.unit.course.teacherId !== me.id) return { ok: false, error: "not found" };
  try {
    const n = await tagTemplate(await aiCtx(me), lessonId, { all });
    revalidatePath(`/builder/${lessonId}`);
    return { ok: true, n };
  } catch (e) { return { ok: false, error: t(`ai.err.${aiCode(e)}`) }; }
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
