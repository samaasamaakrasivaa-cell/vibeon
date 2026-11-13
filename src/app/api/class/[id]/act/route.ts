import { NextResponse, type NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { getSessionUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { classAccess, type LiveState } from "@/lib/live/access";
import { publish, withLock } from "@/lib/live/bus";
import { rateLimit } from "@/lib/rate-limit";
import { parse } from "@/lib/tasks/parse";
import type { TaskType } from "@/lib/tasks/catalog";
import { completeNotes, notify, notifyPayer } from "@/lib/notify";

type Board = { pages: Record<string, unknown>[][] };
const json = (v: unknown) => JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;
const str = (v: unknown, max = 2000) => (typeof v === "string" ? v.slice(0, max) : "");
const bad = (m = "bad") => NextResponse.json({ ok: false, error: m }, { status: 400 });

/** Все действия в классе. Тело: { type, ...данные }. Изменения сразу рассылаются участникам. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  const { id } = await params;
  if (!user) return NextResponse.json({ ok: false }, { status: 401 });
  const acc = await classAccess(id, user);
  if (!acc) return NextResponse.json({ ok: false }, { status: 403 });
  if (!(await rateLimit(`act:${user.id}`, 600, 60))) return NextResponse.json({ ok: false, error: "rate" }, { status: 429 });
  const { lesson, role } = acc;
  const teacher = role === "teacher";
  const ch = `class:${id}`;
  const body = await req.json().catch(() => null);
  if (!body || typeof body.type !== "string") return bad();
  const by = user.id;

  switch (body.type) {
    // ── ответ ученика (или учителя за ученика) по заданию
    case "answer": {
      const sid = lesson.studentId;
      if (!sid) return bad("no student");
      const taskId = str(body.taskId, 60), key = str(body.key, 40);
      if (!taskId || !key || JSON.stringify(body.value ?? null).length > 20000) return bad();
      const task = await db.task.findUnique({ where: { id: taskId }, select: { templateId: true, type: true } });
      if (!task || task.templateId !== lesson.templateId) return bad("task");
      const where = { lessonInstanceId_taskId_studentId: { lessonInstanceId: id, taskId, studentId: sid } };
      return withLock(`answer:${id}:${taskId}`, async () => {
      const prev = await db.answer.findUnique({ where });
      const payload = { ...((prev?.payload as object) ?? {}), [key]: body.value ?? null };
      const teacherCheck = ["essay", "open", "record", "transform", "translate"].includes(task.type);
      const status = key === "checked" && body.value ? (teacherCheck ? "NEEDS_REVIEW" : "AUTO_CHECKED") : prev?.status === "REVIEWED" ? "REVIEWED" : teacherCheck ? "NEEDS_REVIEW" : "SUBMITTED";
      await db.answer.upsert({ where, create: { lessonInstanceId: id, taskId, studentId: sid, payload: json(payload), status }, update: { payload: json(payload), status } });
      publish(ch, "answer", { taskId, key, value: body.value ?? null, by });
      return NextResponse.json({ ok: true });
      });
    }
    // ── состояние урока: рубрика, «показать ученику», скрытые, таймер, доска…
    case "live": {
      if (!teacher) return bad("teacher only");
      const patch = (body.patch ?? {}) as LiveState;
      const allowed: (keyof LiveState)[] = ["rubricId", "spotlight", "hidden", "follow", "lockBoard", "page", "timer", "tab", "scriptOpen", "marks", "marksShown"];
      const clean = Object.fromEntries(Object.entries(patch).filter(([k]) => allowed.includes(k as keyof LiveState)));
      if (JSON.stringify(clean).length > 60000) return bad("big");
      await withLock(`live:${id}`, async () => {
        const fresh = await db.lessonInstance.findUnique({ where: { id }, select: { live: true } });
        const live = { ...((fresh?.live as object) ?? {}), ...clean };
        await db.lessonInstance.update({ where: { id }, data: { live: json(live), startedAt: lesson.startedAt ?? new Date() } });
      });
      publish(ch, "live", clean);
      return NextResponse.json({ ok: true });
    }
    // ── задание урока → в домашку (и обратно)
    case "hw": {
      if (!teacher) return bad("teacher only");
      const taskId = str(body.taskId, 60);
      const hw = await db.homework.upsert({ where: { lessonInstanceId: id }, create: { lessonInstanceId: id, taskIds: [] }, update: {} });
      const extra = body.on ? [...new Set([...hw.extraTaskIds, taskId])] : hw.extraTaskIds.filter((x) => x !== taskId);
      await db.homework.update({ where: { id: hw.id }, data: { extraTaskIds: extra } });
      publish(ch, "hw", { extraTaskIds: extra });
      return NextResponse.json({ ok: true });
    }
    case "training": {
      if (!teacher) return bad("teacher only");
      const kind = body.kind === "review" ? "review" : "new";
      const hw = await db.homework.upsert({ where: { lessonInstanceId: id }, create: { lessonInstanceId: id, taskIds: [] }, update: {} });
      const wt = body.on ? [...new Set([...hw.wordTraining, kind])] : hw.wordTraining.filter((x) => x !== kind);
      await db.homework.update({ where: { id: hw.id }, data: { wordTraining: wt } });
      publish(ch, "hw", { wordTraining: wt });
      return NextResponse.json({ ok: true });
    }
    case "hwComment": {
      if (!teacher) return bad("teacher only");
      const text = str(body.text, 3000);
      await db.homework.upsert({ where: { lessonInstanceId: id }, create: { lessonInstanceId: id, taskIds: [], teacherComment: text || null }, update: { teacherComment: text || null } });
      publish(ch, "hw", { teacherComment: text || null });
      return NextResponse.json({ ok: true });
    }
    // ── доска
    case "board": {
      if (!teacher && (lesson.live as LiveState)?.lockBoard) return bad("locked");
      if (body.op === "laser") { publish(ch, "board", { op: "laser", page: Number(body.page) || 0, obj: body.obj, by }); return NextResponse.json({ ok: true }); }
      return withLock(`board:${id}`, async () => {
      const fresh = await db.lessonInstance.findUnique({ where: { id }, select: { board: true } });
      const board = ((fresh?.board as Board) ?? { pages: [[]] });
      if (!Array.isArray(board.pages) || !board.pages.length) board.pages = [[]];
      const page = Math.max(0, Math.min(Number(body.page) || 0, 30));
      while (board.pages.length <= page) board.pages.push([]);
      const op = body.op;
      const obj = body.obj as { id?: string } | undefined;
      if (op === "add" && obj?.id) { if (JSON.stringify(obj).length > 200000) return bad("big"); board.pages[page].push(obj); }
      else if (op === "update" && obj?.id) board.pages[page] = board.pages[page].map((o) => ((o as { id: string }).id === obj.id ? { ...o, ...obj } : o));
      else if (op === "del" && obj?.id) board.pages[page] = board.pages[page].filter((o) => (o as { id: string }).id !== obj.id);
      else if (op === "clear") board.pages[page] = [];
      else if (op === "newpage") board.pages.push([]);
      else if (op !== "laser") return bad("op");
      if (op !== "laser") await db.lessonInstance.update({ where: { id }, data: { board: json(board) } });
      publish(ch, "board", { op, page, obj, by, pages: op === "newpage" ? board.pages.length : undefined });
      return NextResponse.json({ ok: true });
      });
    }
    // ── чат урока (это переписка учителя и ученика)
    case "chat": {
      if (!lesson.studentId) return bad("no student");
      const text = str(body.text, 4000).trim();
      if (!text) return bad();
      const m = await db.message.create({ data: { studentId: lesson.studentId, senderId: user.id, text } });
      publish(ch, "chat", { id: m.id, text, by, at: m.createdAt });
      publish(`chat:${lesson.studentId}`, "chat", { id: m.id, text, by, at: m.createdAt });
      return NextResponse.json({ ok: true });
    }
    case "note": {
      const text = str(body.text, 4000);
      await db.lessonInstance.update({ where: { id }, data: teacher ? { note: text || null } : { studentNote: text || null } });
      publish(ch, "note", { who: role, text });
      return NextResponse.json({ ok: true });
    }
    // ── «Мне непонятно» → вопрос учителю
    case "question": {
      if (teacher || !lesson.studentId) return bad();
      const text = str(body.text, 2000).trim();
      const taskId = str(body.taskId, 60) || null;
      if (!text) return bad();
      // вопрос, на который уже ответил ИИ, — тот же вопрос, теперь и преподавателю
      const qid = str(body.qid, 60);
      const prev = qid ? await db.question.findUnique({ where: { id: qid } }) : null;
      const q = prev && prev.studentId === lesson.studentId
        ? await db.question.update({ where: { id: prev.id }, data: { askedTeacher: true } })
        : await db.question.create({ data: { studentId: lesson.studentId, taskId, text, askedTeacher: true, context: str(body.context, 300) || null } });
      if (lesson.teacherId)
        await notify({ userId: lesson.teacherId, kind: "question", title: `${user.name}: ${text.slice(0, 120)}`, action: "reply", link: `/class/${id}` });
      publish(ch, "question", { id: q.id, taskId, text, by });
      return NextResponse.json({ ok: true });
    }
    // ── проверка учителем
    case "review": {
      if (!teacher || !lesson.studentId) return bad();
      const taskId = str(body.taskId, 60);
      const where = { lessonInstanceId_taskId_studentId: { lessonInstanceId: id, taskId, studentId: lesson.studentId } };
      // исправления ИИ (после правки учителем) показываются ученику вместе с отзывом
      const a = body.ai && typeof body.ai === "object" ? body.ai : null;
      const ai = a ? {
        source: str(a.source, 20000), corrected: str(a.corrected, 20000), summary: str(a.summary, 3000),
        notes: Array.isArray(a.notes) ? a.notes.slice(0, 40).map((n: Record<string, unknown>) => ({ from: str(n.from, 300), to: str(n.to, 300), why: str(n.why, 300) })) : [],
      } : null;
      const review = { ok: !!body.ok, comment: str(body.comment, 3000) || null, at: new Date().toISOString(), ...(ai ? { ai } : {}) };
      await db.answer.upsert({ where, create: { lessonInstanceId: id, taskId, studentId: lesson.studentId, payload: {}, status: "REVIEWED", teacherReview: review, shownToStudent: !!ai }, update: { status: "REVIEWED", teacherReview: review, shownToStudent: !!ai } });
      publish(ch, "review", { taskId, review });
      // всё в домашке проверено — уведомления о ней у учителя сделаны
      if (!(await db.answer.count({ where: { lessonInstanceId: id, status: "NEEDS_REVIEW", teacherReview: { equals: Prisma.AnyNull } } })))
        if (lesson.teacherId) await completeNotes(lesson.teacherId, { kind: ["homework"], linkStarts: `/class/${id}` });
      return NextResponse.json({ ok: true });
    }
    // ── слова урока у ученика
    case "word": {
      if (!lesson.studentId) return bad();
      if (body.op === "add") {
        const word = str(body.word, 120).trim();
        if (!word) return bad();
        const w = await db.word.create({ data: { studentId: lesson.studentId, word, translation: str(body.tr, 200) || null, example: str(body.ex, 400) || null, sourceLessonId: id } });
        publish(ch, "word", { op: "add", word: w });
      } else if (body.op === "del" && teacher) {
        const w = await db.word.findUnique({ where: { id: str(body.wid, 60) } });
        if (w?.studentId !== lesson.studentId) return bad();
        await db.word.delete({ where: { id: w.id } });
        publish(ch, "word", { op: "del", id: w.id });
      } else return bad();
      return NextResponse.json({ ok: true });
    }
    case "feedback": {
      if (!teacher || !lesson.studentId) return bad();
      const text = str(body.text, 5000).trim();
      if (!text) return bad();
      await db.feedback.create({ data: { studentId: lesson.studentId, lessonInstanceId: id, text } });
      await notifyPayer(lesson.studentId, `Отзыв преподавателя об уроке (${lesson.student?.name ?? ""}):\n${text.slice(0, 1500)}`);
      if (lesson.student?.userId) await notify({ userId: lesson.student.userId, kind: "feedback", title: `${user.name}: ${text.slice(0, 120)}`, action: "open_profile", link: "/student/progress" });
      return NextResponse.json({ ok: true });
    }
    // ── выбрать урок из курсов для этого занятия
    case "template": {
      if (!teacher) return bad();
      const t = await db.lessonTemplate.findUnique({ where: { id: str(body.templateId, 60) }, include: { unit: { include: { course: true } } } });
      if (!t || t.unit.course.teacherId !== user.id) return bad();
      await db.lessonInstance.update({ where: { id }, data: { templateId: t.id } });
      publish(ch, "reload", {});
      return NextResponse.json({ ok: true });
    }
    case "reload": {
      if (!teacher) return bad();
      publish(ch, "reload", {});
      return NextResponse.json({ ok: true });
    }
    // ── завершить урок: статус «проведён», домашка ученику, слова урока — в его список
    case "finish": {
      if (!teacher) return bad();
      const tpl = lesson.templateId ? await db.lessonTemplate.findUnique({ where: { id: lesson.templateId }, include: { tasks: true } }) : null;
      const hwTasks = tpl?.tasks.filter((t) => t.section === "homework" && !t.hidden && !(t.options as { teacherOnly?: boolean } | null)?.teacherOnly).map((t) => t.id) ?? [];
      const hw = await db.homework.upsert({ where: { lessonInstanceId: id }, create: { lessonInstanceId: id, taskIds: hwTasks }, update: { taskIds: hwTasks } });
      const hasHw = hw.taskIds.length + hw.extraTaskIds.length + hw.wordTraining.length > 0;
      if (lesson.studentId && tpl) {
        const have = new Set((await db.word.findMany({ where: { studentId: lesson.studentId }, select: { word: true } })).map((w) => w.word.toLowerCase()));
        const items = tpl.tasks.filter((t) => t.type === "wordset").flatMap((t) => { const p = parse(t.type as TaskType, t.content); return p.kind === "wordset" ? p.items : []; });
        const add = items.filter((w) => !have.has(w.word.toLowerCase()));
        if (add.length) await db.word.createMany({ data: add.map((w) => ({ studentId: lesson.studentId!, word: w.word, translation: w.tr || null, example: w.ex || null, sourceLessonId: id })) });
      }
      await db.lessonInstance.update({ where: { id }, data: { status: "DONE", finishedAt: new Date() } });
      if (lesson.studentId) await notifyPayer(lesson.studentId, `Урок английского прошёл: ${lesson.student?.name ?? ""}, ${new Date().toLocaleDateString("ru-RU", { day: "numeric", month: "long", timeZone: user.timezone })}.${hasHw ? " Домашнее задание выдано." : ""}`);
      if (lesson.student?.userId)
        await notify({ userId: lesson.student.userId, kind: "lesson_done", title: hasHw ? (user.lang === "EN" ? "The lesson is over — homework is waiting" : "Урок окончен — тебя ждёт домашка") : (user.lang === "EN" ? "The lesson is over" : "Урок окончен"), action: "review", link: `/class/${id}?tab=homework` });
      publish(ch, "finished", { hasHw });
      return NextResponse.json({ ok: true });
    }
    default:
      return bad("type");
  }
}
