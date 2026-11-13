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
  const { lesson, role, host, slot, group } = acc;
  const teacher = role === "teacher";
  const ch = `class:${host.id}`; // у группового занятия класс общий
  const body = await req.json().catch(() => null);
  if (!body || typeof body.type !== "string") return bad();
  const by = user.id;
  // чей урок: ученик — свой; учитель в группе — выбранный ученик (studentId), иначе — этот урок
  const tg = role === "student" ? acc.own! : group ? slot.find((x) => x.studentId && x.studentId === str(body.studentId, 60)) ?? null : lesson;
  const slotIds = slot.map((x) => x.id);

  switch (body.type) {
    // ── ответ ученика (или учителя за ученика) по заданию
    case "answer": {
      const sid = tg?.studentId;
      if (!tg || !sid) return bad("no student");
      const taskId = str(body.taskId, 60), key = str(body.key, 40);
      if (!taskId || !key || JSON.stringify(body.value ?? null).length > 20000) return bad();
      const task = await db.task.findUnique({ where: { id: taskId }, select: { templateId: true, type: true } });
      if (!task || task.templateId !== host.templateId) return bad("task");
      const where = { lessonInstanceId_taskId_studentId: { lessonInstanceId: tg.id, taskId, studentId: sid } };
      return withLock(`answer:${tg.id}:${taskId}`, async () => {
      const prev = await db.answer.findUnique({ where });
      const payload = { ...((prev?.payload as object) ?? {}), [key]: body.value ?? null };
      const teacherCheck = ["essay", "open", "record", "transform", "translate"].includes(task.type);
      const status = key === "checked" && body.value ? (teacherCheck ? "NEEDS_REVIEW" : "AUTO_CHECKED") : prev?.status === "REVIEWED" ? "REVIEWED" : teacherCheck ? "NEEDS_REVIEW" : "SUBMITTED";
      await db.answer.upsert({ where, create: { lessonInstanceId: tg.id, taskId, studentId: sid, payload: json(payload), status }, update: { payload: json(payload), status } });
      publish(ch, "answer", { taskId, key, value: body.value ?? null, by, sid });
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
      await withLock(`live:${host.id}`, async () => {
        const fresh = await db.lessonInstance.findUnique({ where: { id: host.id }, select: { live: true } });
        const live = { ...((fresh?.live as object) ?? {}), ...clean };
        await db.lessonInstance.update({ where: { id: host.id }, data: { live: json(live), startedAt: host.startedAt ?? new Date() } });
      });
      publish(ch, "live", clean);
      return NextResponse.json({ ok: true });
    }
    // ── задание урока → в домашку (и обратно)
    case "hw": {
      if (!teacher) return bad("teacher only");
      const taskId = str(body.taskId, 60);
      let extra: string[] = [];
      for (const lid of slotIds) { // групповое занятие — домашка всем ученикам
        const hw = await db.homework.upsert({ where: { lessonInstanceId: lid }, create: { lessonInstanceId: lid, taskIds: [] }, update: {} });
        extra = body.on ? [...new Set([...hw.extraTaskIds, taskId])] : hw.extraTaskIds.filter((x) => x !== taskId);
        await db.homework.update({ where: { id: hw.id }, data: { extraTaskIds: extra } });
      }
      publish(ch, "hw", { extraTaskIds: extra });
      return NextResponse.json({ ok: true });
    }
    case "training": {
      if (!teacher) return bad("teacher only");
      const kind = body.kind === "review" ? "review" : "new";
      let wt: string[] = [];
      for (const lid of slotIds) {
        const hw = await db.homework.upsert({ where: { lessonInstanceId: lid }, create: { lessonInstanceId: lid, taskIds: [] }, update: {} });
        wt = body.on ? [...new Set([...hw.wordTraining, kind])] : hw.wordTraining.filter((x) => x !== kind);
        await db.homework.update({ where: { id: hw.id }, data: { wordTraining: wt } });
      }
      publish(ch, "hw", { wordTraining: wt });
      return NextResponse.json({ ok: true });
    }
    case "hwComment": {
      if (!teacher) return bad("teacher only");
      const text = str(body.text, 3000);
      for (const lid of slotIds) await db.homework.upsert({ where: { lessonInstanceId: lid }, create: { lessonInstanceId: lid, taskIds: [], teacherComment: text || null }, update: { teacherComment: text || null } });
      publish(ch, "hw", { teacherComment: text || null });
      return NextResponse.json({ ok: true });
    }
    // ── доска
    case "board": {
      if (!teacher && (host.live as LiveState)?.lockBoard) return bad("locked");
      if (body.op === "laser") { publish(ch, "board", { op: "laser", page: Number(body.page) || 0, obj: body.obj, by }); return NextResponse.json({ ok: true }); }
      return withLock(`board:${host.id}`, async () => {
      const fresh = await db.lessonInstance.findUnique({ where: { id: host.id }, select: { board: true } });
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
      if (op !== "laser") await db.lessonInstance.update({ where: { id: host.id }, data: { board: json(board) } });
      publish(ch, "board", { op, page, obj, by, pages: op === "newpage" ? board.pages.length : undefined });
      return NextResponse.json({ ok: true });
      });
    }
    // ── чат урока (это переписка учителя и ученика)
    case "chat": {
      if (group || !lesson.studentId) return bad("no student"); // в групповом занятии переписка — в «Сообщениях» с каждым учеником
      const text = str(body.text, 4000).trim();
      if (!text) return bad();
      const m = await db.message.create({ data: { studentId: lesson.studentId, senderId: user.id, text } });
      publish(ch, "chat", { id: m.id, text, by, at: m.createdAt });
      publish(`chat:${lesson.studentId}`, "chat", { id: m.id, text, by, at: m.createdAt });
      return NextResponse.json({ ok: true });
    }
    case "note": {
      const text = str(body.text, 4000);
      if (teacher) await db.lessonInstance.updateMany({ where: { id: { in: slotIds } }, data: { note: text || null } });
      else await db.lessonInstance.update({ where: { id: lesson.id }, data: { studentNote: text || null } });
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
      if (!teacher || !tg?.studentId) return bad();
      const taskId = str(body.taskId, 60);
      const where = { lessonInstanceId_taskId_studentId: { lessonInstanceId: tg.id, taskId, studentId: tg.studentId } };
      // исправления ИИ (после правки учителем) показываются ученику вместе с отзывом
      const a = body.ai && typeof body.ai === "object" ? body.ai : null;
      const ai = a ? {
        source: str(a.source, 20000), corrected: str(a.corrected, 20000), summary: str(a.summary, 3000),
        notes: Array.isArray(a.notes) ? a.notes.slice(0, 40).map((n: Record<string, unknown>) => ({ from: str(n.from, 300), to: str(n.to, 300), why: str(n.why, 300) })) : [],
      } : null;
      const review = { ok: !!body.ok, comment: str(body.comment, 3000) || null, at: new Date().toISOString(), ...(ai ? { ai } : {}) };
      await db.answer.upsert({ where, create: { lessonInstanceId: tg.id, taskId, studentId: tg.studentId, payload: {}, status: "REVIEWED", teacherReview: review, shownToStudent: !!ai }, update: { status: "REVIEWED", teacherReview: review, shownToStudent: !!ai } });
      publish(ch, "review", { taskId, review, sid: tg.studentId });
      // всё в домашке проверено — уведомления о ней у учителя сделаны
      if (!(await db.answer.count({ where: { lessonInstanceId: tg.id, status: "NEEDS_REVIEW", teacherReview: { equals: Prisma.AnyNull } } })))
        if (lesson.teacherId) await completeNotes(lesson.teacherId, { kind: ["homework"], linkStarts: `/class/${tg.id}` });
      return NextResponse.json({ ok: true });
    }
    // ── слова урока у ученика
    case "word": {
      if (!tg?.studentId) return bad();
      if (body.op === "add") {
        const word = str(body.word, 120).trim();
        if (!word) return bad();
        const w = await db.word.create({ data: { studentId: tg.studentId, word, translation: str(body.tr, 200) || null, example: str(body.ex, 400) || null, sourceLessonId: tg.id } });
        publish(ch, "word", { op: "add", word: w, sid: tg.studentId });
      } else if (body.op === "del" && teacher) {
        const w = await db.word.findUnique({ where: { id: str(body.wid, 60) } });
        if (w?.studentId !== tg.studentId) return bad();
        await db.word.delete({ where: { id: w.id } });
        publish(ch, "word", { op: "del", id: w.id, sid: tg.studentId });
      } else return bad();
      return NextResponse.json({ ok: true });
    }
    case "feedback": {
      if (!teacher || !tg?.studentId) return bad();
      const text = str(body.text, 5000).trim();
      if (!text) return bad();
      await db.feedback.create({ data: { studentId: tg.studentId, lessonInstanceId: tg.id, text } });
      await notifyPayer(tg.studentId, `Отзыв преподавателя об уроке (${tg.student?.name ?? ""}):\n${text.slice(0, 1500)}`);
      if (tg.student?.userId) await notify({ userId: tg.student.userId, kind: "feedback", title: `${user.name}: ${text.slice(0, 120)}`, action: "open_profile", link: "/student/progress" });
      return NextResponse.json({ ok: true });
    }
    // ── выбрать урок из курсов для этого занятия
    case "template": {
      if (!teacher) return bad();
      const t = await db.lessonTemplate.findUnique({ where: { id: str(body.templateId, 60) }, include: { unit: { include: { course: true } } } });
      if (!t || t.unit.course.teacherId !== user.id) return bad();
      await db.lessonInstance.updateMany({ where: { id: { in: slotIds } }, data: { templateId: t.id } });
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
      const tpl = host.templateId ? await db.lessonTemplate.findUnique({ where: { id: host.templateId }, include: { tasks: true } }) : null;
      const hwTasks = tpl?.tasks.filter((t) => t.section === "homework" && !t.hidden && !(t.options as { teacherOnly?: boolean } | null)?.teacherOnly).map((t) => t.id) ?? [];
      const items = tpl ? tpl.tasks.filter((t) => t.type === "wordset").flatMap((t) => { const p = parse(t.type as TaskType, t.content); return p.kind === "wordset" ? p.items : []; }) : [];
      let anyHw = false;
      // групповое занятие — каждому ученику: домашка, слова урока, «урок проведён», уведомления
      for (const l of slot) {
        const hw = await db.homework.upsert({ where: { lessonInstanceId: l.id }, create: { lessonInstanceId: l.id, taskIds: hwTasks }, update: { taskIds: hwTasks } });
        const hasHw = hw.taskIds.length + hw.extraTaskIds.length + hw.wordTraining.length > 0;
        anyHw ||= hasHw;
        if (l.studentId && items.length) {
          const have = new Set((await db.word.findMany({ where: { studentId: l.studentId }, select: { word: true } })).map((w) => w.word.toLowerCase()));
          const add = items.filter((w) => !have.has(w.word.toLowerCase()));
          if (add.length) await db.word.createMany({ data: add.map((w) => ({ studentId: l.studentId!, word: w.word, translation: w.tr || null, example: w.ex || null, sourceLessonId: l.id })) });
        }
        await db.lessonInstance.update({ where: { id: l.id }, data: { status: "DONE", finishedAt: new Date() } });
        if (l.studentId) await notifyPayer(l.studentId, `Урок английского прошёл: ${l.student?.name ?? ""}, ${new Date().toLocaleDateString("ru-RU", { day: "numeric", month: "long", timeZone: user.timezone })}.${hasHw ? " Домашнее задание выдано." : ""}`);
        if (l.student?.userId)
          await notify({ userId: l.student.userId, kind: "lesson_done", title: hasHw ? (user.lang === "EN" ? "The lesson is over — homework is waiting" : "Урок окончен — тебя ждёт домашка") : (user.lang === "EN" ? "The lesson is over" : "Урок окончен"), action: "review", link: `/class/${l.id}?tab=homework` });
      }
      publish(ch, "finished", { hasHw: anyHw });
      return NextResponse.json({ ok: true });
    }
    default:
      return bad("type");
  }
}
