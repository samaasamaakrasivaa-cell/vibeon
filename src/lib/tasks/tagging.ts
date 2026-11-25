import "server-only";
// Разметка заданий ИИ без проверки прав (вызывают действия учителя и итог урока).
import type { Prisma } from "@prisma/client";
import { db } from "../db";
import { llmFor } from "../ai/gateway";
import { modelsFor } from "../ai/models";
import { prompt } from "../ai/prompts";
import { runJson } from "../ai/route-core";
import type { Ctx } from "../ai/gateway";
import { catalogFor, cleanTags, type TaskTags } from "./tags";

export const NO_TAG = new Set(["divider", "image", "audio", "video", "link", "note", "info"]);

function cleanOut(raw: Record<string, unknown>) {
  const xs = Array.isArray(raw.tasks) ? raw.tasks as Record<string, unknown>[] : [];
  if (!xs.length) throw new Error("tags: empty");
  return xs.map((x) => ({ n: Number(x.n), tags: cleanTags({ ...x, by: "ai" }), title: typeof x.title === "string" ? x.title.trim().slice(0, 400) : "" }));
}

export async function tagBatch(ctx: Ctx, lesson: { course: string; title: string; level: string | null }, tasks: { n: number; type: string; title: string; content: string }[]) {
  const input = { lesson, catalog: catalogFor(lesson.level), tasks: tasks.map((x) => ({ ...x, content: x.content.slice(0, 1500) })) };
  const run = await runJson(llmFor("route", ctx), modelsFor("route"), prompt("task-tags"), input, cleanOut, { tag: "task-tags", maxTokens: 4000, temperature: 0.1 });
  return run.data;
}

/** Разметить задания урока: без метки (или все, кроме поставленных учителем). Возвращает, сколько размечено. */
export async function tagTemplate(ctx: Ctx, templateId: string, o: { all?: boolean; only?: string[] } = {}) {
  const l = await db.lessonTemplate.findUnique({ where: { id: templateId }, include: { unit: { include: { course: true } }, tasks: { orderBy: { order: "asc" } } } });
  if (!l) return 0;
  const todo = l.tasks.filter((x) => {
    if (NO_TAG.has(x.type)) return false;
    if (o.only && !o.only.includes(x.id)) return false;
    const tg = ((x.options ?? {}) as { tags?: TaskTags }).tags;
    return o.all ? tg?.by !== "teacher" : !tg?.topic && !tg?.topicName;
  });
  let n = 0;
  for (let i = 0; i < todo.length; i += 10) {
    const part = todo.slice(i, i + 10);
    const out = await tagBatch(ctx, { course: l.unit.course.title, title: l.title, level: l.unit.course.level }, part.map((x, k) => ({ n: k + 1, type: x.type, title: x.title, content: x.content })));
    for (const r of out) {
      const task = part[r.n - 1];
      if (!task || !r.tags) continue;
      const prev = ((task.options ?? {}) as { tags?: TaskTags }).tags;
      const hint = r.title && r.title !== task.title.trim() ? r.title : undefined;
      const opts = { ...((task.options ?? {}) as object), tags: { ...(prev ?? {}), ...r.tags, ...(hint ? { hint } : {}) } };
      await db.task.update({ where: { id: task.id }, data: { options: JSON.parse(JSON.stringify(opts)) as Prisma.InputJsonValue } });
      n++;
    }
  }
  return n;
}
