"use server";
// Проверка работ ученика ИИ в уроке (домашка): запуск, сравнение двух моделей, сохранение правок учителя.
// «ОК, показать ученику» — в /api/class/[id]/act (review): там итог учителя попадает ученику и считается «Качество ИИ».
import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { db } from "../db";
import { requireUser } from "../auth/session";
import { getT } from "../i18n/server";
import { parse } from "../tasks/parse";
import { cleanInfo } from "../tasks/teacher-info";
import { aiCtx, aiCode } from "./ctx";
import { llmFor } from "./gateway";
import { modelLabel, modelsFor } from "./models";
import { prompt } from "./prompts";
import { teacherCriteria } from "./criteria";
import { checkWith, cleanFinal, EXAMS, runCheck, scrubWithMap, unscrub, type CheckInput, type CheckMeta, type CheckResult, type CheckTaskType, type Exam } from "./check-core";

export type ReviewDTO = {
  id: string; model: string; label: string; status: string; exam: Exam; taskType: CheckTaskType; text: string;
  draft: CheckResult; final: CheckResult | null; meta: CheckMeta; compareGroup: string | null; chosen: boolean; at: string;
};
type Ok<T> = ({ ok: true } & T) | { ok: false; error: string };

const json = (v: unknown) => v as Prisma.InputJsonValue;
const TYPE_OF: Record<string, CheckTaskType> = { essay: "essay", open: "open_answer", record: "speech_transcript" };

/** Урок, задание и ответ ученика — только своему учителю. */
async function load(lessonInstanceId: string, taskId: string) {
  const user = await requireUser("TEACHER");
  const lesson = await db.lessonInstance.findUnique({ where: { id: lessonInstanceId }, include: { student: true, template: { select: { teacherInfo: true, tasks: { where: { type: "vocab" }, select: { content: true } } } } } });
  if (!lesson || lesson.teacherId !== user.id || !lesson.studentId || !lesson.student) throw new Error("not found");
  const task = await db.task.findUnique({ where: { id: taskId } });
  if (!task || task.templateId !== lesson.templateId) throw new Error("not found");
  const taskType = TYPE_OF[task.type];
  if (!taskType) throw new Error("type");
  const ans = await db.answer.findUnique({ where: { lessonInstanceId_taskId_studentId: { lessonInstanceId, taskId, studentId: lesson.studentId } } });
  const p = (ans?.payload ?? {}) as Record<string, unknown>;
  let text = "", taskPrompt = `${task.title}\n${task.content}`;
  if (task.type === "essay") text = String(p.text ?? "");
  else if (task.type === "record") text = String((p.rec as { transcript?: string } | undefined)?.transcript ?? "");
  else {
    // открытый ответ: вопросы — в задании, ответы ученика — по номерам
    const q = parse("open", task.content);
    const items = q.kind === "lines" ? q.items : [task.content];
    const val = (p.val ?? {}) as Record<number, string>;
    text = items.map((_, i) => (val[i] ?? "").trim()).map((a, i) => (items.length > 1 ? `${i + 1}) ${a || "—"}` : a)).join("\n");
    taskPrompt = `${task.title}\n${items.map((x, i) => (items.length > 1 ? `${i + 1}) ${x}` : x)).join("\n")}`;
  }
  return { user, lesson, student: lesson.student, task, taskType, text: text.slice(0, 12000), taskPrompt: taskPrompt.slice(0, 4000) };
}

/** Экзамен по умолчанию — по маршруту ученика (ОГЭ, ЕГЭ, IELTS). */
async function guessExam(studentId: string, taskType: CheckTaskType): Promise<Exam> {
  const r = await db.roadmap.findFirst({ where: { studentId }, orderBy: { createdAt: "desc" }, select: { type: true } });
  if (r?.type === "oge") return "oge";
  if (r?.type === "ege") return "ege";
  if (r?.type === "ielts") return taskType === "speech_transcript" ? "ielts_speaking" : taskType === "essay" ? "ielts_writing_task2" : "none";
  return "none";
}

const dto = (r: { id: string; model: string; status: string; exam: string; taskType: string; input: unknown; draft: unknown; final: unknown; meta: unknown; compareGroup: string | null; chosen: boolean; createdAt: Date }): ReviewDTO => ({
  id: r.id, model: r.model, label: modelLabel(r.model), status: r.status, exam: r.exam as Exam, taskType: r.taskType as CheckTaskType,
  text: (r.input as CheckInput).student_text, draft: r.draft as CheckResult, final: (r.final as CheckResult | null) ?? null, meta: r.meta as CheckMeta,
  compareGroup: r.compareGroup, chosen: r.chosen, at: r.createdAt.toISOString(),
});

/** Последняя проверка этого ответа (в режиме сравнения — оба варианта) и экзамен по умолчанию. */
export async function aiReviewLoad(lessonInstanceId: string, taskId: string): Promise<Ok<{ reviews: ReviewDTO[]; exam: Exam; criteria: { oge: boolean; ege: boolean }; models: string[] }>> {
  try {
    const { user, student, taskType } = await load(lessonInstanceId, taskId);
    const last = await db.aiReview.findFirst({ where: { lessonInstanceId, taskId, studentId: student.id, teacherId: user.id }, orderBy: { createdAt: "desc" } });
    const rows = last?.compareGroup ? await db.aiReview.findMany({ where: { compareGroup: last.compareGroup }, orderBy: { createdAt: "asc" } }) : last ? [last] : [];
    const crit = await teacherCriteria(user.id);
    return { ok: true, reviews: rows.map(dto), exam: (last?.exam as Exam) ?? (await guessExam(student.id, taskType)), criteria: { oge: !!crit.oge?.trim(), ege: !!crit.ege?.trim() }, models: modelsFor("check").map(modelLabel) };
  } catch (e) { return { ok: false, error: (e as Error).message }; }
}

/** «Проверить через ИИ» (compare — сразу двумя моделями, рядом). Черновик видит только учитель. */
export async function aiReviewRun(lessonInstanceId: string, taskId: string, opts: { exam?: string; compare?: boolean }): Promise<Ok<{ reviews: ReviewDTO[] }>> {
  const { t } = await getT();
  let c;
  try { c = await load(lessonInstanceId, taskId); } catch { return { ok: false, error: t("ai.err.fail") }; }
  const { user, lesson, student, taskType, text, taskPrompt } = c;
  if (!text.replace(/[\d)\s—-]/g, "")) return { ok: false, error: t("ai.err.noAnswer") };
  const exam: Exam = (EXAMS as readonly string[]).includes(opts.exam ?? "") ? (opts.exam as Exam) : await guessExam(student.id, taskType);
  const crit = await teacherCriteria(user.id);
  const criteria = exam === "oge" ? crit.oge ?? "" : exam === "ege" ? crit.ege ?? "" : "";
  // в фокусе урока — слова и грамматика урока (цели из конструктора, рамки Useful vocabulary)
  const aims = cleanInfo(lesson.template?.teacherInfo).aims;
  const focus = [aims?.vocabulary && `Vocabulary: ${aims.vocabulary}`, aims?.grammar && `Grammar: ${aims.grammar}`, ...(lesson.template?.tasks ?? []).map((x) => `Useful vocabulary: ${x.content.replace(/\n+/g, "; ")}`)].filter(Boolean).join("\n").slice(0, 2000);
  const notes = Object.values((student.privateNotes ?? {}) as Record<string, string>).filter((x) => typeof x === "string" && x.trim()).join("\n").slice(0, 1500);
  // личные данные — заменяем; позиции правок потом возвращаются к исходному тексту
  const names = [student.name, student.lastName, user.name, user.lastName];
  const sc = scrubWithMap(text, names);
  const clean = (s: string) => scrubWithMap(s, names).text;
  const input: CheckInput = { task_type: taskType, level: student.level ?? "", exam, exam_criteria: criteria.slice(0, 12000), task_prompt: clean(taskPrompt), lesson_focus: clean(focus), teacher_notes: clean(notes), student_text: sc.text };
  const llm = llmFor("check", { ...(await aiCtx(user)) });
  const P = { check: prompt("check-1"), review: prompt("check-2-review") };
  const models = modelsFor("check");
  const stored = { ...input, student_text: text, exam_criteria: criteria ? "(критерии учителя)" : "", task_prompt: taskPrompt, lesson_focus: focus, teacher_notes: notes ? "(заметки учителя)" : "" };
  const save = (model: string, result: CheckResult, meta: CheckMeta, group: string | null, chosen: boolean) => db.aiReview.create({
    data: { teacherId: user.id, studentId: student.id, lessonInstanceId, taskId, taskType, exam, input: json(stored), model, draft: json(result), meta: json(meta), compareGroup: group, chosen },
  });
  try {
    if (opts.compare && models.length > 1) {
      const group = randomUUID();
      const runs = await Promise.allSettled(models.map((m) => checkWith(llm, m, input, P)));
      const rows = [];
      let first = true;
      for (let i = 0; i < runs.length; i++) {
        const r = runs[i];
        if (r.status === "fulfilled") { rows.push(await save(models[i], unscrub(r.value.result, sc, text), r.value.meta, group, first)); first = false; }
        else console.error(`[ai:compare] ${models[i]}`, r.reason);
      }
      if (!rows.length) return { ok: false, error: t("ai.err.fail") };
      return { ok: true, reviews: rows.map(dto) };
    }
    const r = await runCheck(llm, models, input, P);
    const row = await save(r.meta.model, unscrub(r.result, sc, text), r.meta, null, true);
    return { ok: true, reviews: [dto(row)] };
  } catch (e) {
    console.error("[ai:review]", e);
    return { ok: false, error: t(`ai.err.${aiCode(e)}`) };
  }
}

/** Своя проверка учителя: сохранить правки (до «ОК»). */
export async function aiReviewSave(id: string, final: unknown): Promise<Ok<{ final: CheckResult }>> {
  const user = await requireUser("TEACHER");
  const r = await db.aiReview.findUnique({ where: { id } });
  if (!r || r.teacherId !== user.id) return { ok: false, error: "not found" };
  const f = cleanFinal(final, (r.input as CheckInput).student_text);
  if (!f) return { ok: false, error: "bad" };
  await db.aiReview.update({ where: { id }, data: { final: json(f) } });
  return { ok: true, final: f };
}

/** Режим сравнения: какой вариант учитель взял в работу. */
export async function aiReviewChoose(id: string): Promise<Ok<object>> {
  const user = await requireUser("TEACHER");
  const r = await db.aiReview.findUnique({ where: { id } });
  if (!r || r.teacherId !== user.id) return { ok: false, error: "not found" };
  if (r.compareGroup) {
    await db.$transaction([
      db.aiReview.updateMany({ where: { compareGroup: r.compareGroup, teacherId: user.id }, data: { chosen: false } }),
      db.aiReview.update({ where: { id }, data: { chosen: true } }),
    ]);
  }
  return { ok: true };
}
