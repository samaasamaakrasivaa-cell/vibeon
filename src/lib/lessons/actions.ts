"use server";
// Итог урока — действия учителя: засчитать / оставить ошибкой, добавить ответ в варианты ключа,
// пересобрать, утвердить (после этого итог видит ученик).
import { revalidatePath } from "next/cache";
import type { Prisma } from "@prisma/client";
import { db } from "../db";
import { requireUser } from "../auth/session";
import { parse } from "../tasks/parse";
import type { TaskType } from "../tasks/catalog";
import { buildLessonSummary, type Check } from "./summary";

type R = { ok: true } | { ok: false; error: string };
const json = (v: unknown) => JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;

async function ownSummary(id: string) {
  const me = await requireUser("TEACHER");
  const s = await db.lessonSummary.findUnique({ where: { id }, include: { student: true } });
  if (!s || s.student.teacherId !== me.id) throw new Error("not found");
  return s;
}
const refresh = (studentId: string) => { revalidatePath(`/teacher/students/${studentId}`); revalidatePath("/student/progress"); };

/** «Засчитать» (ответ верный) или «Оставить ошибкой». Итог пересчитывается. */
export async function resolveCheck(summaryId: string, checkId: string, accept: boolean): Promise<R> {
  const s = await ownSummary(summaryId);
  const checks = (s.checks as Check[]).map((c) => (c.id === checkId ? { ...c, status: accept ? "accepted" as const : "kept" as const, ...(accept ? {} : { verdict: c.verdict === "correct" || c.verdict === "unverified" ? "topic_error" as const : c.verdict }) } : c));
  await db.lessonSummary.update({ where: { id: s.id }, data: { checks: json(checks) } });
  await buildLessonSummary(s.lessonInstanceId, s.studentId);
  refresh(s.studentId);
  return { ok: true };
}

/** Найти n-й непустой ряд содержания (как его видит разбор) — индекс строки в исходном тексте. */
const rawLine = (content: string, n: number) => {
  const ls = content.split(/\r?\n/);
  let k = -1;
  for (let i = 0; i < ls.length; i++) if (ls[i].trim()) { k++; if (k === n) return i; }
  return -1;
};

/** «Добавить в варианты ответа»: ответ ученика становится верным вариантом задания — навсегда, для всех. */
export async function addToKey(summaryId: string, checkId: string): Promise<R> {
  const s = await ownSummary(summaryId);
  const c = (s.checks as Check[]).find((x) => x.id === checkId);
  if (!c) return { ok: false, error: "check" };
  const task = await db.task.findUnique({ where: { id: c.taskId }, include: { template: { include: { unit: { include: { course: true } } } } } });
  if (!task || task.template.unit.course.teacherId !== s.student.teacherId) return { ok: false, error: "task" };
  const given = c.given.replace(/[[\]/|]/g, " ").trim();
  if (!given) return { ok: false, error: "empty" };
  let content = task.content;
  const p = parse(task.type as TaskType, content);
  if (task.type === "gap" && p.kind === "gaps") {
    // ключ пропуска «строка:сегмент» → порядковый номер пропуска во всём тексте
    const [li, si] = c.key.split(":").map(Number);
    let ord = 0;
    p.lines.forEach((l, i) => l.forEach((x, j) => { if (x.t === "gap" && (i < li || (i === li && j < si))) ord++; }));
    let k = -1;
    content = content.replace(/\[([^\]]+)\]/g, (m, inner: string) => (++k === ord ? `[${inner} / ${given}]` : m));
  } else if (task.type === "errors") {
    const i = rawLine(content, Number(c.key));
    if (i < 0) return { ok: false, error: "line" };
    const ls = content.split(/\r?\n/);
    ls[i] = ls[i].replace(/\[([^\]]+)\]/, (_m, inner: string) => `[${inner} / ${given}]`);
    content = ls.join("\n");
  } else if (task.type === "transform" || task.type === "translate") {
    const i = rawLine(content, Number(c.key));
    if (i < 0) return { ok: false, error: "line" };
    const ls = content.split(/\r?\n/);
    ls[i] = /(→|->)/.test(ls[i]) ? `${ls[i].trimEnd()} / ${given}` : `${ls[i].trimEnd()} → ${given}`;
    content = ls.join("\n");
  } else return { ok: false, error: "type" };
  if (content === task.content) return { ok: false, error: "nochange" };
  await db.task.update({ where: { id: task.id }, data: { content } });
  return resolveCheck(summaryId, checkId, true);
}

/** Пересобрать итог (например, после домашки). */
export async function rebuildSummary(summaryId: string): Promise<R> {
  const s = await ownSummary(summaryId);
  await buildLessonSummary(s.lessonInstanceId, s.studentId);
  refresh(s.studentId);
  return { ok: true };
}

/** Собрать итог урока вручную (если урок завершили до появления итогов). */
export async function buildSummaryFor(lessonInstanceId: string, studentId: string): Promise<R> {
  const me = await requireUser("TEACHER");
  const st = await db.student.findUnique({ where: { id: studentId } });
  if (!st || st.teacherId !== me.id) return { ok: false, error: "not found" };
  await buildLessonSummary(lessonInstanceId, studentId);
  refresh(studentId);
  return { ok: true };
}

/** «Утвердить итог»: теперь его видит ученик (как результаты вводного теста). */
export async function approveSummary(summaryId: string, on = true): Promise<R> {
  const s = await ownSummary(summaryId);
  await db.lessonSummary.update({ where: { id: s.id }, data: { status: on ? "approved" : "draft", approvedAt: on ? new Date() : null } });
  refresh(s.studentId);
  return { ok: true };
}

/** Порог освоенности ученика (по умолчанию 75%): ниже — пробел, от порога до 90% — на контроле. */
export async function setThreshold(studentId: string, n: number): Promise<R> {
  const me = await requireUser("TEACHER");
  const st = await db.student.findUnique({ where: { id: studentId } });
  if (!st || st.teacherId !== me.id) return { ok: false, error: "not found" };
  const v = Math.max(50, Math.min(89, Math.round(n)));
  const r = await db.roadmap.findFirst({ where: { studentId }, orderBy: { createdAt: "desc" } });
  if (!r) return { ok: false, error: "no roadmap" };
  await db.roadmap.update({ where: { id: r.id }, data: { meta: json({ ...((r.meta ?? {}) as object), threshold: v }) } });
  refresh(studentId);
  return { ok: true };
}
