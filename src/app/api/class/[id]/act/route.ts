import { cleanFinal, compareEdits, type CheckResult } from "@/lib/ai/check-core";
import { buildLessonSummary } from "@/lib/lessons/summary";
import { NextResponse, type NextRequest } from "next/server";
import { carriedOne, isEmptyPayload } from "@/lib/class/carry";
import { Prisma } from "@prisma/client";
import { getSessionUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { classAccess, type LiveState } from "@/lib/live/access";
import { publish, withLock } from "@/lib/live/bus";
import { startLessonSession, withLessonLifecycleLock, type LessonFinishedEvent } from "@/lib/live/lesson-session";
import { inLessonNow } from "@/lib/student/in-lesson";
import { rateLimit } from "@/lib/rate-limit";
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
      const prev0 = await db.answer.findUnique({ where });
      // ответа здесь ещё нет, а на прошлом занятии того же урока был — продолжаем с него (копия в это занятие)
      const carried = !prev0 || isEmptyPayload(prev0.payload) ? await carriedOne(tg.id, sid, taskId) : null;
      const prev = carried ? { ...(prev0 ?? {}), payload: carried.payload, status: carried.status } as NonNullable<typeof prev0> : prev0;
      const payload = { ...((prev?.payload as object) ?? {}), [key]: body.value ?? null };
      const teacherCheck = ["essay", "open", "record", "transform", "translate"].includes(task.type);
      // комментарии учителя к полям (gnotes) — не ответ ученика: статус не меняется
      // комментарии и исправленная версия от учителя (gnotes, corr, corrSent) — не ответ ученика; ученик их не пишет
      // «проработали» (worked) — отметка учителя в уроке, тоже не ответ ученика
      if (["gnotes", "corr", "corrSent", "worked"].includes(key) && !teacher) return bad("teacher only");
      if (key === "rounds") return bad("rounds");
      const status = ["gnotes", "corr", "corrSent", "worked"].includes(key) ? prev?.status ?? "DRAFT" : key === "checked" && body.value ? (teacherCheck ? "NEEDS_REVIEW" : "AUTO_CHECKED") : prev?.status === "REVIEWED" ? "REVIEWED" : teacherCheck ? "NEEDS_REVIEW" : "SUBMITTED";
      await db.answer.upsert({ where, create: { lessonInstanceId: tg.id, taskId, studentId: sid, payload: json(payload), status }, update: { payload: json(payload), status } });
      publish(ch, "answer", { taskId, key, value: body.value ?? null, by, sid });
      // учитель отправил исправленную версию — ученику уведомление (один раз на задание)
      if (key === "corrSent" && teacher && tg.student?.userId) {
        const su = await db.user.findUnique({ where: { id: tg.student.userId }, select: { lang: true } });
        await notify({ userId: tg.student.userId, kind: "feedback", title: su?.lang === "EN" ? "Your teacher has checked your work" : "Преподаватель проверил твою работу", action: "review", link: `/class/${tg.id}`, dedupe: `corr:${tg.id}:${taskId}` });
      }
      return NextResponse.json({ ok: true });
      });
    }
    // ── общие заметки урока ученика: пишут и ученик, и учитель; у каждого ученика группы — свои
    case "snote": {
      if (!tg?.studentId) return bad("student");
      const text = str(body.text, 6000);
      await db.lessonInstance.update({ where: { id: tg.id }, data: { studentNote: text || null } });
      publish(ch, "snote", { sid: tg.studentId, text, by });
      return NextResponse.json({ ok: true });
    }
    // ── «Сбросить ответы» задания: одному ученику (studentId) или всем ученикам занятия
    case "reset": {
      if (!teacher) return bad("teacher only");
      const taskId = str(body.taskId, 60);
      if (!taskId) return bad();
      const who = str(body.studentId, 60) || null;
      const ids = who ? slot.filter((x) => x.studentId === who).map((x) => x.id) : slotIds;
      if (!ids.length) return bad("student");
      await db.answer.deleteMany({ where: { lessonInstanceId: { in: ids }, taskId } });
      publish(ch, "reset", { taskId, sid: who ?? (group ? null : lesson.studentId) });
      return NextResponse.json({ ok: true });
    }
    // ── активное время ученика над заданиями (клиент шлёт раз в минуту): во время урока по расписанию — lessonMs, иначе — hwMs
    case "tick": {
      if (teacher || !tg?.studentId) return NextResponse.json({ ok: true });
      const items = (body.items && typeof body.items === "object" ? body.items : {}) as Record<string, unknown>;
      const ids = Object.keys(items).slice(0, 30);
      if (!ids.length) return NextResponse.json({ ok: true });
      const ok = new Set((await db.task.findMany({ where: { id: { in: ids }, templateId: host.templateId ?? "" }, select: { id: true } })).map((x) => x.id));
      const lessonNow = await inLessonNow([tg.studentId]);
      for (const taskId of ids) {
        const ms = Math.round(Number(items[taskId]));
        if (!ok.has(taskId) || !(ms > 0)) continue;
        const add = Math.min(ms, 120_000); // не больше 2 минут за раз
        const where = { lessonInstanceId_taskId_studentId: { lessonInstanceId: tg.id, taskId, studentId: tg.studentId } };
        await db.answer.upsert({ where, create: { lessonInstanceId: tg.id, taskId, studentId: tg.studentId, payload: {}, status: "DRAFT", ...(lessonNow ? { lessonMs: add } : { hwMs: add }) }, update: lessonNow ? { lessonMs: { increment: add } } : { hwMs: { increment: add } } });
      }
      return NextResponse.json({ ok: true });
    }
    // ── «Решить заново»: ученик (или учитель за него) начинает задание с чистого листа; прошлые ответы не теряются —
    //    уходят в «попытки» (rounds), учитель видит, что было до сброса. Комментарии и исправления учителя остаются.
    case "retry": {
      const sid = tg?.studentId;
      if (!tg || !sid) return bad("no student");
      const taskId = str(body.taskId, 60);
      if (!taskId) return bad();
      const where = { lessonInstanceId_taskId_studentId: { lessonInstanceId: tg.id, taskId, studentId: sid } };
      return withLock(`answer:${tg.id}:${taskId}`, async () => {
        const prev0 = await db.answer.findUnique({ where });
        const carried = !prev0 || isEmptyPayload(prev0.payload) ? await carriedOne(tg.id, sid, taskId) : null;
        const prev = carried ? { payload: carried.payload } : prev0;
        const p = ((prev?.payload as Record<string, unknown>) ?? {});
        const KEEP = ["rounds", "gnotes", "corr", "corrSent"];
        const snap = Object.fromEntries(Object.entries(p).filter(([k]) => !KEEP.includes(k)));
        if (!prev || !Object.keys(snap).length) return NextResponse.json({ ok: true });
        const rounds = [...((p.rounds as unknown[]) ?? []), { at: new Date().toISOString(), by: teacher ? "teacher" : "student", p: snap }].slice(-10);
        const payload = { ...Object.fromEntries(Object.entries(p).filter(([k]) => KEEP.includes(k) && k !== "rounds")), rounds };
        await db.answer.upsert({ where, create: { lessonInstanceId: tg.id, taskId, studentId: sid, payload: json(payload), status: "DRAFT" }, update: { payload: json(payload), status: "DRAFT", teacherReview: Prisma.DbNull, shownToStudent: false } });
        publish(ch, "retry", { taskId, sid, payload, by });
        return NextResponse.json({ ok: true });
      });
    }
    case "startLessonSession": {
      if (!teacher) return bad("teacher only");
      const revision: unknown = body.revision;
      if (body.startsAt !== host.startsAt.getTime() || (revision !== null && (typeof revision !== "string" || revision.length !== 36))) return bad("stale lesson");
      if (!await startLessonSession(host.id, user.id, host.startsAt, revision)) return bad("stale lesson");
      return NextResponse.json({ ok: true });
    }
    // ── состояние урока: рубрика, «показать ученику», скрытые, таймер, доска…
    case "live": {
      if (!teacher) return bad("teacher only");
      const patch = (body.patch ?? {}) as LiveState;
      const allowed: (keyof LiveState)[] = ["rubricId", "spotlight", "hidden", "follow", "lockBoard", "page", "timer", "tab", "scriptOpen", "marks", "marksShown", "hwErr"];
      const clean = Object.fromEntries(Object.entries(patch).filter(([k]) => allowed.includes(k as keyof LiveState)));
      if (JSON.stringify(clean).length > 60000) return bad("big");
      await withLock(`live:${host.id}`, async () => {
        await db.$transaction(async (tx) => {
          const [fresh] = await tx.$queryRaw<{ live: Prisma.JsonValue; startedAt: Date | null }[]>`
            SELECT "live", "startedAt" FROM "LessonInstance" WHERE "id" = ${host.id} FOR UPDATE
          `;
          if (!fresh) throw new Error("lesson not found");
          const live = { ...((fresh.live as object) ?? {}), ...clean };
          await tx.lessonInstance.update({ where: { id: host.id }, data: { live: json(live), startedAt: fresh.startedAt ?? new Date() } });
        });
      });
      publish(ch, "live", clean);
      return NextResponse.json({ ok: true });
    }
    // ── задание урока → в домашку (и обратно)
    case "hw": {
      if (!teacher) return bad("teacher only");
      // одно задание (taskId) или несколько сразу («Задать все заготовки», ids) — в конец списка, в том порядке, как задавали
      const list = (Array.isArray(body.ids) ? (body.ids as unknown[]).slice(0, 100).map((x) => str(x, 60)) : [str(body.taskId, 60)]).filter(Boolean);
      let extra: string[] = [];
      for (const lid of slotIds) { // групповое занятие — домашка всем ученикам
        const hw = await db.homework.upsert({ where: { lessonInstanceId: lid }, create: { lessonInstanceId: lid, taskIds: [] }, update: {} });
        extra = body.on ? [...new Set([...hw.extraTaskIds, ...list])] : hw.extraTaskIds.filter((x) => !list.includes(x));
        await db.homework.update({ where: { id: hw.id }, data: { extraTaskIds: extra } });
      }
      publish(ch, "hw", { extraTaskIds: extra });
      return NextResponse.json({ ok: true });
    }
    // ── убрать задание из домашки (добавили по ошибке): с урока — снять перенос; из раздела «Домашка» — скрыть для этого занятия
    case "hwRemove": case "hwRestore": {
      if (!teacher) return bad("teacher only");
      const taskId = str(body.taskId, 60);
      let x = { extraTaskIds: [] as string[], removedTaskIds: [] as string[] };
      for (const lid of slotIds) {
        const hw = await db.homework.upsert({ where: { lessonInstanceId: lid }, create: { lessonInstanceId: lid, taskIds: [] }, update: {} });
        const data = body.type === "hwRemove"
          ? { extraTaskIds: hw.extraTaskIds.filter((y) => y !== taskId), taskIds: hw.taskIds.filter((y) => y !== taskId), removedTaskIds: hw.extraTaskIds.includes(taskId) ? hw.removedTaskIds : [...new Set([...hw.removedTaskIds, taskId])] }
          : { removedTaskIds: [], taskIds: hw.taskIds.length ? [...new Set([...hw.taskIds, ...hw.removedTaskIds])] : hw.taskIds };
        const u = await db.homework.update({ where: { id: hw.id }, data });
        x = { extraTaskIds: u.extraTaskIds, removedTaskIds: u.removedTaskIds };
      }
      publish(ch, "hw", x);
      return NextResponse.json({ ok: true });
    }
    // ── порядок заданий домашки (учитель перетащил или нажал стрелку) — всем ученикам занятия
    case "hwOrder": {
      if (!teacher) return bad("teacher only");
      const order = Array.isArray(body.order) ? (body.order as unknown[]).map((x) => str(x, 60)).filter(Boolean).slice(0, 300) : [];
      for (const lid of slotIds) await db.homework.upsert({ where: { lessonInstanceId: lid }, create: { lessonInstanceId: lid, taskIds: [], taskOrder: order }, update: { taskOrder: order } });
      publish(ch, "hw", { taskOrder: order });
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
    case "chat": case "chatEdit": case "chatDel": {
      // групповой урок — общий чат группы (учитель и все ученики); иначе — переписка учителя и ученика.
      // Ответ на сообщение (replyTo), правка и удаление — только своих сообщений.
      const gid = group ? host.groupId ?? lesson.groupId : null;
      if (group && !gid) return bad("no group");
      if (!group && !lesson.studentId) return bad("no student");
      const out = (m: { id: string; text: string; senderId: string; createdAt: Date; replyTo: string | null; editedAt: Date | null; deletedAt: Date | null }) => {
        const x = { id: m.id, text: m.deletedAt ? "" : m.text, by: m.senderId, at: m.createdAt, replyTo: m.replyTo, edited: !!m.editedAt, deleted: !!m.deletedAt };
        publish(ch, "chat", x);
        if (!group) publish(`chat:${lesson.studentId}`, "chat", x);
      };
      if (body.type === "chat") {
        const text = str(body.text, 4000).trim();
        if (!text) return bad();
        const rid = str(body.replyTo, 40);
        const reply = rid && (group ? await db.groupMessage.findFirst({ where: { id: rid, groupId: gid! } }) : await db.message.findFirst({ where: { id: rid, studentId: lesson.studentId! } })) ? rid : null;
        const m = group ? await db.groupMessage.create({ data: { groupId: gid!, senderId: user.id, text, replyTo: reply } }) : await db.message.create({ data: { studentId: lesson.studentId!, senderId: user.id, text, replyTo: reply } });
        out(m);
        return NextResponse.json({ ok: true });
      }
      const id = str(body.id, 40);
      const own = group ? await db.groupMessage.findFirst({ where: { id, groupId: gid!, senderId: user.id } }) : await db.message.findFirst({ where: { id, studentId: lesson.studentId!, senderId: user.id } });
      if (!own) return bad("not yours");
      const text = str(body.text, 4000).trim();
      if (body.type === "chatEdit" && !text) return bad();
      const data = body.type === "chatEdit" ? { text, editedAt: new Date() } : { deletedAt: new Date() };
      const m = group ? await db.groupMessage.update({ where: { id }, data }) : await db.message.update({ where: { id }, data });
      out(m);
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
    // ученик указывает учителю на задание («посмотрите сюда»): у учителя задание мигает, сверху — кто указал
    // учитель показывает на заметки урока: всем (sid пусто) или одному ученику группы — увидит только он
    case "notepoint": {
      if (!teacher) return bad();
      publish(ch, "notepoint", { sid: str(body.studentId, 60) || null });
      return NextResponse.json({ ok: true });
    }
    case "goto": {
      // учитель ведёт ученика в другой класс (разбор ошибок домашки прошлого урока и обратно); доступ проверит страница
      if (!teacher) return bad();
      const url = str(body.url, 200);
      if (!/^\/class\/[A-Za-z0-9_-]+(\?[A-Za-z0-9_=&-]*)?$/.test(url)) return bad();
      publish(ch, "goto", { url });
      return NextResponse.json({ ok: true });
    }
    case "point": {
      const taskId = str(body.taskId, 60);
      if (!taskId) return bad();
      publish(ch, "point", { taskId, by, name: user.name, where: str(body.where, 20) });
      return NextResponse.json({ ok: true });
    }
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
      // новая проверка ИИ (эссе, открытый ответ, запись): итог учителя → ученику; черновик и итог — в «Качество ИИ»
      let ai2: CheckResult | null = null, ai2src = "";
      const rid = str(body.aiReviewId, 40);
      if (rid) {
        const ar = await db.aiReview.findUnique({ where: { id: rid } });
        if (ar && ar.teacherId === user.id && ar.lessonInstanceId === tg.id && ar.taskId === taskId) {
          ai2src = (ar.input as { student_text: string }).student_text;
          ai2 = cleanFinal(body.ai2 ?? ar.final ?? ar.draft, ai2src);
          if (ai2) {
            await db.aiReview.update({ where: { id: rid }, data: { final: ai2 as unknown as Prisma.InputJsonObject, status: "approved", approvedAt: new Date(), chosen: true, stats: compareEdits(ar.draft as unknown as CheckResult, ai2) as unknown as Prisma.InputJsonObject } });
            if (ar.compareGroup) await db.aiReview.updateMany({ where: { compareGroup: ar.compareGroup, id: { not: rid } }, data: { chosen: false } });
          }
        }
      }
      const review = { ok: !!body.ok, comment: str(body.comment, 3000) || null, at: new Date().toISOString(), ...(ai ? { ai } : {}), ...(ai2 ? { ai2: { ...ai2, source: ai2src } } : {}) };
      await db.answer.upsert({ where, create: { lessonInstanceId: tg.id, taskId, studentId: tg.studentId, payload: {}, status: "REVIEWED", teacherReview: review, shownToStudent: !!ai || !!ai2 }, update: { status: "REVIEWED", teacherReview: review, shownToStudent: !!ai || !!ai2 } });
      publish(ch, "review", { taskId, review, sid: tg.studentId });
      // всё в домашке проверено — уведомления о ней у учителя сделаны
      if (!(await db.answer.count({ where: { lessonInstanceId: tg.id, status: "NEEDS_REVIEW", teacherReview: { equals: Prisma.AnyNull } } })))
        if (lesson.teacherId) await completeNotes(lesson.teacherId, { kind: ["homework"], linkStarts: `/class/${tg.id}` });
      return NextResponse.json({ ok: true });
    }
    // ── слова урока у ученика
    case "word": {
      if (!tg?.studentId) return bad();
      const studentId = tg.studentId;
      if (body.op === "add") {
        const word = str(body.word, 120).trim();
        if (!word) return bad();
        const dictionary = body.dictionary === true;
        const inputTranslation = str(body.tr, 200);
        const translation = (dictionary ? inputTranslation.trim() : inputTranslation) || null;
        if (dictionary && !translation) return bad();
        return withLock(`word:${studentId}`, async () => {
          const select = { id: true, word: true, translation: true, example: true, level: true };
          const existing = await db.word.findFirst({
            where: { studentId, word: { equals: word, mode: "insensitive" } },
            orderBy: [{ createdAt: "asc" }, { id: "asc" }],
            select,
          });
          let saved = existing;
          let status = "existing";
          if (!saved) {
            saved = await db.word.create({
              data: { studentId, word, translation, example: str(body.ex, 400) || null, sourceLessonId: tg.id },
              select,
            });
            status = "added";
          } else if (dictionary && translation && !saved.translation?.trim()) {
            const { count } = await db.word.updateMany({
              where: { id: saved.id, studentId, translation: saved.translation },
              data: { translation },
            });
            saved = await db.word.findUnique({ where: { id: saved.id }, select });
            if (!saved) return bad();
            if (count) status = "updated";
          }
          publish(ch, "word", { op: "add", word: saved, sid: studentId });
          return NextResponse.json({ ok: true, ...(dictionary ? { status, translation: saved.translation } : {}) });
        });
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
      if (tg.student?.userId) await notify({ userId: tg.student.userId, kind: "feedback", title: `${user.name}: ${text.slice(0, 120)}`, action: "open_profile", link: "/student/progress?tab=feedback" });
      return NextResponse.json({ ok: true });
    }
    // ── учитель подарил «приятность» — ученик сразу видит праздничное окно в классе
    case "cheer": {
      if (!teacher) return bad();
      const a = await db.award.findUnique({ where: { id: str(body.awardId, 60) } });
      if (!a || a.teacherId !== user.id || !slot.some((x) => x.studentId === a.studentId)) return bad();
      publish(ch, "cheer", { sid: a.studentId, award: { id: a.id, kind: a.kind, name: a.name, why: a.why, icon: a.icon, color: a.color, until: null } });
      return NextResponse.json({ ok: true });
    }
    // ── выбрать урок из курсов для этого занятия
    case "template": {
      if (!teacher) return bad();
      const t = await db.lessonTemplate.findUnique({ where: { id: str(body.templateId, 60) }, include: { unit: { include: { course: true } } } });
      if (!t || t.unit.course.teacherId !== user.id) return bad();
      // что с прежним уроком: «пройден» или «не закончен — вернёмся»; выбранный урок — снова в работе
      const owner = host.groupId ? `g:${host.groupId}` : host.studentId ? `s:${host.studentId}` : null;
      const prev = body.prev === "done" || body.prev === "paused" ? body.prev : null;
      if (owner && prev && host.templateId && host.templateId !== t.id)
        await db.lessonProgress.upsert({ where: { owner_templateId: { owner, templateId: host.templateId } }, create: { owner, templateId: host.templateId, state: prev }, update: { state: prev } });
      if (owner) await db.lessonProgress.deleteMany({ where: { owner, templateId: t.id, state: "paused" } });
      await db.lessonInstance.updateMany({ where: { id: { in: slotIds } }, data: { templateId: t.id } });
      publish(ch, "reload", {});
      return NextResponse.json({ ok: true });
    }
    case "reload": {
      if (!teacher) return bad();
      publish(ch, "reload", {});
      return NextResponse.json({ ok: true });
    }
    // ── завершить урок: статус «проведён» и назначенная домашка
    case "finish": {
      if (!teacher) return bad();
      const completed = await withLessonLifecycleLock(user.id, host, async () => {
        const participants = await db.lessonInstance.findMany({
          where: { ...(host.slotId ? { slotId: host.slotId } : { id: host.id }), teacherId: user.id, status: { not: "CANCELLED" } },
          include: { student: true },
          orderBy: { id: "asc" },
        });
        if (!participants.length) return null;
        const tpl = host.templateId ? await db.lessonTemplate.findUnique({ where: { id: host.templateId }, include: { tasks: true } }) : null;
        const hwTasks = tpl?.tasks.filter((t) => t.section === "homework" && !t.hidden && !(t.options as { teacherOnly?: boolean } | null)?.teacherOnly).sort((a, b) => a.order - b.order).map((t) => t.id) ?? [];
        const outcomes: { lesson: (typeof participants)[number]; hasHw: boolean }[] = [];
        for (const l of participants) {
          // Заготовки получает только ученик, которому учитель их задал либо выбрал при завершении.
          const prev = await db.homework.findUnique({ where: { lessonInstanceId: l.id } });
          const manual = prev ? prev.manual : true;
          const hw = manual
            ? await db.homework.upsert({ where: { lessonInstanceId: l.id }, create: { lessonInstanceId: l.id, taskIds: [], extraTaskIds: body.prepared ? hwTasks : [] },
                update: body.prepared ? { extraTaskIds: [...new Set([...(prev?.extraTaskIds ?? []), ...hwTasks.filter((x) => !(prev?.removedTaskIds ?? []).includes(x))])] } : {} })
            : await db.homework.upsert({ where: { lessonInstanceId: l.id }, create: { lessonInstanceId: l.id, taskIds: hwTasks }, update: { taskIds: hwTasks } });
          const hasHw = hw.taskIds.length + hw.extraTaskIds.length + hw.wordTraining.length > 0;
          await db.lessonInstance.update({ where: { id: l.id }, data: { status: "DONE", finishedAt: new Date() } });
          outcomes.push({ lesson: l, hasHw });
        }
        return outcomes;
      });
      if (!completed) return NextResponse.json({ ok: false, error: "lesson cancelled" }, { status: 409 });
      for (const { lesson: l, hasHw } of completed) {
        if (l.studentId) await notifyPayer(l.studentId, `Урок английского прошёл: ${l.student?.name ?? ""}, ${new Date().toLocaleDateString("ru-RU", { day: "numeric", month: "long", timeZone: user.timezone })}.${hasHw ? " Домашнее задание выдано." : ""}`);
        if (l.student?.userId)
          await notify({ userId: l.student.userId, kind: "lesson_done", title: hasHw ? (user.lang === "EN" ? "The lesson is over — homework is waiting" : "Урок окончен — тебя ждёт домашка") : (user.lang === "EN" ? "The lesson is over" : "Урок окончен"), action: "review", link: `/class/${l.id}?tab=homework` });
      }
      // итог урока по каждому ученику — в фоне (разметка тем, проверка сомнительных ответов ИИ), учитель увидит его в досье
      for (const { lesson: l } of completed) if (l.studentId) void buildLessonSummary(l.id, l.studentId).catch((e) => console.error("[summary]", (e as Error).message));
      const finished: LessonFinishedEvent = { lessons: completed.map(({ lesson, hasHw }) => ({ id: lesson.id, hasHw })) };
      publish(ch, "finished", finished);
      return NextResponse.json({ ok: true });
    }
    default:
      return bad("type");
  }
}
