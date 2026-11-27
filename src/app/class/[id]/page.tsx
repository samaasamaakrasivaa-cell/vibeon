import { getCatalog } from "@/lib/awards/catalog-db";
import { ActivityPing } from "@/components/ActivityPing";
import { notFound } from "next/navigation";
import type { TInfo } from "@/lib/tasks/teacher-info";
import { ClassRoom, type AiCheck, type Review } from "@/components/class/ClassRoom";
import type { BObj } from "@/components/class/Board";
import type { Answers } from "@/components/tasks/store";
import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getT } from "@/lib/i18n/server";
import { classAccess, type LiveState } from "@/lib/live/access";
import { hasStartedLessonSession, lessonOccurrence } from "@/lib/live/lesson-session";
import { loadLesson } from "@/lib/teacher/builder-data";
import { parse } from "@/lib/tasks/parse";
import { hhmm } from "@/lib/time";
import { nextStudentLesson } from "@/lib/student/next-lesson";
import { homeworkFor } from "@/lib/homework";
import { currentHomeworkAnswers } from "@/lib/homework-review";
import { carriedAnswers, isEmptyPayload } from "@/lib/class/carry";
import { hadWrongTry, isFinal, progressOf } from "@/lib/tasks/progress";
import type { TaskOptions, TaskType } from "@/lib/tasks/catalog";

export const metadata = { title: "Урок" };
export const dynamic = "force-dynamic";

/** Класс: урок в реальном времени для учителя и ученика. */
export default async function ClassPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string; addhw?: string; preview?: string }> }) {
  const { lang } = await getT();
  const user = await requireUser();
  const { id } = await params;
  const acc = await classAccess(id, user);
  if (!acc) notFound();
  // «Как видит ученик»: учитель открывает урок глазами ученика — только просмотр, без отправки действий
  const preview = acc.role === "teacher" && (await searchParams).preview === "student";
  const { lesson, host, slot, group } = acc;
  const role: "teacher" | "student" = preview ? "student" : acc.role;
  const { lessonSession: _lessonSession, ...live } = (host.live ?? {}) as LiveState & { lessonSession?: unknown };
  const teacherUser = await db.user.findUnique({ where: { id: lesson.teacherId ?? "" }, include: { teacherProfile: true } });
  if (!teacherUser) notFound();
  // урок не выбран — остаётся закреплённый в прошлый раз у этого ученика (у группы — у группы); учитель сменит его кнопкой «Другой урок»
  let templateId = host.templateId;
  if (!templateId && (host.groupId || host.studentId)) {
    const who = host.groupId ? { groupId: host.groupId } : { studentId: host.studentId, groupId: null };
    const prev = (await db.lessonInstance.findFirst({ where: { ...who, templateId: { not: null }, startsAt: { lte: host.startsAt } }, orderBy: { startsAt: "desc" }, select: { templateId: true } }))
      ?? (await db.lessonInstance.findFirst({ where: { ...who, templateId: { not: null } }, orderBy: { startsAt: "desc" }, select: { templateId: true } }));
    if (prev?.templateId) {
      templateId = prev.templateId;
      await db.lessonInstance.updateMany({ where: { id: { in: slot.map((x) => x.id) } }, data: { templateId } });
    }
  }
  const data = templateId ? await loadLesson(templateId) : null;
  // групповое занятие: учитель видит уроки всех учеников, ученик — только свой
  const ids = role === "teacher" ? slot.map((x) => x.id) : [lesson.id];
  const [rows0, hw, allWords, messages, templates, grp, otherHomework] = await Promise.all([
    db.answer.findMany({ where: { lessonInstanceId: { in: ids } } }),
    db.homework.findUnique({ where: { lessonInstanceId: lesson.id } }),
    db.word.findMany({ where: { sourceLessonId: { in: ids } }, orderBy: { createdAt: "asc" } }),
    lesson.studentId && !group ? db.message.findMany({ where: { studentId: lesson.studentId }, orderBy: { createdAt: "desc" }, take: 50 }) : [],
    role === "teacher" ? db.lessonTemplate.findMany({ where: { unit: { course: { teacherId: teacherUser.id } } }, include: { unit: { include: { course: true } } }, orderBy: [{ unit: { course: { order: "asc" } } }, { unit: { order: "asc" } }, { order: "asc" }] }) : [],
    group && (host.groupId ?? lesson.groupId) ? db.group.findUnique({ where: { id: (host.groupId ?? lesson.groupId)! }, select: { title: true, callLink: true, messages: { orderBy: { createdAt: "desc" }, take: 60 } } }) : null,
    group && role === "teacher" ? db.homework.findMany({
      where: { lessonInstanceId: { in: ids.filter((lessonId) => lessonId !== lesson.id) } },
      select: { lessonInstanceId: true, manual: true, extraTaskIds: true, removedTaskIds: true },
    }) : [],
  ]);
  // продолжаем тот же урок, что и на прошлом занятии: ответы по заданиям урока — с прошлого занятия, пока здесь их нет
  let carriedFrom: Date | null = null;
  const allRows = [...rows0];
  if (templateId) {
    for (const m of slot.filter((x) => ids.includes(x.id) && x.studentId)) {
      const base = await carriedAnswers({ lessonIds: slot.map((x) => x.id), studentId: m.studentId!, templateId, before: host.startsAt });
      for (const [taskId, b] of base) {
        const i = allRows.findIndex((a) => a.lessonInstanceId === m.id && a.taskId === taskId && a.studentId === m.studentId);
        if (i >= 0 && !isEmptyPayload(allRows[i].payload)) continue;
        const cur = i >= 0 ? allRows[i] : null;
        const row = { ...(cur ?? { id: `carry-${taskId}`, lessonInstanceId: m.id, taskId, studentId: m.studentId!, lessonMs: 0, hwMs: 0, aiDraft: null, shownToStudent: false, createdAt: b.startsAt, updatedAt: b.startsAt }), payload: b.payload, status: b.status, teacherReview: b.teacherReview } as (typeof rows0)[number];
        if (i >= 0) allRows[i] = row; else allRows.push(row);
        if (!carriedFrom || b.startsAt > carriedFrom) carriedFrom = b.startsAt;
      }
    }
  }
  // домашка прошлого урока этого ученика — чтобы на этом уроке разобрать ошибки (индивидуальные уроки)
  const prevHw = !group && lesson.studentId ? await (async () => {
    const items = (await homeworkFor({ studentId: lesson.studentId! })).filter((h) => h.lesson.id !== lesson.id && h.lesson.startsAt < lesson.startsAt);
    const h = items.sort((a, b) => +b.lesson.startsAt - +a.lesson.startsAt)[0];
    if (!h) return null;
    const ids = new Set([...h.lesson.homework!.taskIds, ...h.lesson.homework!.extraTaskIds]);
    const errors = (h.lesson.template?.tasks ?? []).filter((tk) => ids.has(tk.id)).filter((tk) => {
      const a = h.lesson.answers.find((x) => x.taskId === tk.id)?.payload as Record<string, unknown> | undefined;
      if (!a) return false;
      if (hadWrongTry(tk, a)) return true; // ошибался по пути (красные точки), даже если потом исправил
      if (!isFinal({ options: (tk.options ?? {}) as TaskOptions }, a)) return false;
      const st = progressOf({ ...tk, type: tk.type as TaskType, options: (tk.options ?? {}) as TaskOptions }, a);
      return !!st && st.some((x) => x === "bad");
    }).length;
    return { id: h.lesson.id, date: h.lesson.startsAt.toLocaleDateString(lang === "ru" ? "ru-RU" : "en-GB", { day: "numeric", month: "long", timeZone: user.timezone }), done: h.done, total: h.total, errors };
  })() : null;
  // чат группового урока: имена всех участников
  const chatNames: Record<string, string> = Object.fromEntries(slot.filter((x) => x.student?.userId).map((x) => [x.student!.userId!, x.student!.name]));
  // ответы, проверки и слова — по ученикам
  const pack = (sid: string | null) => {
    const rows = allRows.filter((a) => a.studentId === sid);
    return {
      answers: Object.fromEntries(rows.filter((a) => Object.keys((a.payload as object) ?? {}).length).map((a) => [a.taskId, a.payload as Record<string, unknown>])) as Answers,
      statuses: Object.fromEntries(rows.map((a) => [a.taskId, a.status])) as Record<string, string>,
      times: Object.fromEntries(rows.filter((a) => a.lessonMs || a.hwMs).map((a) => [a.taskId, [a.lessonMs, a.hwMs]])) as Record<string, [number, number]>,
      reviews: Object.fromEntries(rows.filter((a) => a.teacherReview).map((a) => [a.taskId, a.teacherReview as Review])),
      aiDrafts: role === "teacher" ? Object.fromEntries(rows.filter((a) => a.aiDraft).map((a) => [a.taskId, a.aiDraft as AiCheck])) : {},
      words: allWords.filter((w) => w.studentId === sid).map((w) => ({ id: w.id, word: w.word, translation: w.translation, example: w.example, level: w.level })),
      note: slot.find((x) => x.studentId === sid)?.studentNote ?? "",
    };
  };
  const members = slot.filter((x) => x.student).map((x) => ({ sid: x.student!.id, instanceId: x.id, userId: x.student!.userId, name: [x.student!.name, x.student!.lastName].filter(Boolean).join(" "), gender: x.student!.gender }));
  // Продолженные с другого урока ответы видны в задании, но сами по себе не требуют проверки этой домашки.
  const homeworkReviewStatuses = role === "teacher" ? Object.fromEntries(members.map((m) => [
    m.sid, Object.fromEntries(currentHomeworkAnswers(rows0, m.instanceId, m.sid)
      .filter((answer) => !isEmptyPayload(answer.payload))
      .map((answer) => [answer.taskId, answer.status])),
  ])) : undefined;
  const homeworkByLesson = new Map(otherHomework.map(({ lessonInstanceId, ...assignment }) => [lessonInstanceId, assignment]));
  const groupReviewAssignments = group && role === "teacher" ? Object.fromEntries(members.flatMap((m) => {
    const assignment = homeworkByLesson.get(m.instanceId);
    return assignment ? [[m.sid, assignment] as const] : [];
  })) : undefined;
  const answersRows = allRows.filter((a) => a.studentId === lesson.studentId);
  const words = allWords.filter((w) => w.studentId === lesson.studentId);
  const answers: Answers = Object.fromEntries(answersRows.filter((a) => Object.keys((a.payload as object) ?? {}).length).map((a) => [a.taskId, a.payload as Record<string, unknown>]));
  const statuses = Object.fromEntries(answersRows.map((a) => [a.taskId, a.status]));
  // активное время ученика над заданиями: на уроке / вне урока (домашка) — учителю
  const times = role === "teacher" ? Object.fromEntries(answersRows.filter((a) => a.lessonMs || a.hwMs).map((a) => [a.taskId, [a.lessonMs, a.hwMs]])) as Record<string, [number, number]> : {};
  const reviews = Object.fromEntries(answersRows.filter((a) => a.teacherReview).map((a) => [a.taskId, a.teacherReview as Review]));
  // черновики проверки ИИ видит только учитель
  const aiDrafts = role === "teacher" ? Object.fromEntries(answersRows.filter((a) => a.aiDraft).map((a) => [a.taskId, a.aiDraft as AiCheck])) : {};
  const lessonWords = (data?.tasks ?? []).filter((x) => x.type === "wordset").flatMap((x) => { const p = parse("wordset", x.content); return p.kind === "wordset" ? p.items : []; });
  const tz = user.timezone;
  const loc = lang === "ru" ? "ru-RU" : "en-GB";
  const now = new Date();
  const nextLesson = acc.role === "student" && acc.own.status === "DONE" && acc.own.finishedAt
    ? await nextStudentLesson(user.id, now) : null;
  const roadmap = lesson.studentId && !group ? await db.roadmap.findFirst({ where: { studentId: lesson.studentId, approvedAt: { not: null } }, orderBy: { createdAt: "desc" } }) : null;
  const board = (host.board as { pages?: BObj[][] })?.pages ?? [[]];
  return (
    <>
    {role === "student" && !preview && <ActivityPing cls />}
    <ClassRoom
      d={{
        id, templateId: templateId, role, me: { id: user.id, name: user.name }, ...(preview ? { preview: true } : {}),
        ...(group ? { group: { title: grp?.title ?? members.map((m) => m.name.split(" ")[0]).join(", "), members: role === "teacher" ? members : members.filter((m) => m.instanceId === lesson.id) } } : {}),
        ...(group && role === "teacher" ? { byStudent: Object.fromEntries(members.map((m) => [m.sid, pack(m.sid)])) } : {}),
        teacher: { id: teacherUser.id, name: teacherUser.name, lastName: teacherUser.lastName },
        student: lesson.student && !(group && role === "teacher") ? { id: lesson.student.id, userId: lesson.student.userId, name: lesson.student.name, lastName: lesson.student.lastName, level: lesson.student.level, course: lesson.student.course, gender: lesson.student.gender } : null,
        title: data?.l.title ?? null,
        crumbs: data ? `${data.l.unit.course.title} · Unit ${data.unitNo} · Lesson ${data.lessonNo}` : null,
        course: data ? { title: data.l.unit.course.title, cover: data.l.cover || data.l.unit.course.cover } : null,
        rubrics: data?.rubrics ?? [], tasks: (data?.tasks ?? []).filter((x) => role === "teacher" || !x.options?.teacherOnly).map((x) => (role === "teacher" || (!x.options?.teacherKey && !x.options?.help?.hidden) ? x : { ...x, options: { ...x.options, teacherKey: undefined, help: x.options?.help?.hidden ? undefined : x.options?.help } })), /* заметки «только учителю», ответы для учителя и скрытые Useful phrases ученику не отдаём */ answers, statuses, reviews, aiDrafts, times, homeworkReviewStatuses, groupReviewAssignments,
        ...(role === "teacher" && data?.l.teacherInfo ? { teacherInfo: data.l.teacherInfo as TInfo } : {}),
        live, board,
        ...(role === "teacher" && host.status === "PLANNED" ? { lessonSession: { ...lessonOccurrence(host), active: hasStartedLessonSession(host) } } : {}),
        ...(nextLesson ? { completionNext: {
          startsAt: nextLesson.startsAt.getTime(), initialNow: now.getTime(),
          when: nextLesson.startsAt.toLocaleString(loc, { dateStyle: "medium", timeStyle: "short", timeZone: tz }),
        } } : {}),
        prevHw,
        tgLinked: role === "student" ? !!user.telegramChatId : null,
        carriedFrom: carriedFrom ? (carriedFrom as Date).toLocaleDateString(lang === "ru" ? "ru-RU" : "en-GB", { day: "numeric", month: "long", timeZone: user.timezone }) : null,
        homework: { extraTaskIds: hw?.extraTaskIds ?? [], wordTraining: hw?.wordTraining ?? [], teacherComment: hw?.teacherComment ?? null, taskOrder: hw?.taskOrder ?? [], removedTaskIds: hw?.removedTaskIds ?? [], manual: hw ? hw.manual : true },
        lessonWords, words: words.map((w) => ({ id: w.id, word: w.word, translation: w.translation, example: w.example, level: w.level })),
        messages: (group ? [...(grp?.messages ?? [])] : messages).reverse().map((m) => ({ id: m.id, text: m.deletedAt ? "" : m.text, by: m.senderId, at: m.createdAt.toISOString(), replyTo: m.replyTo, edited: !!m.editedAt, deleted: !!m.deletedAt })),
        ...(group ? { chatNames } : {}),
        note: host.note, studentNote: role === "student" ? lesson.studentNote : group ? null : lesson.studentNote,
        // одна ссылка на созвон: из анкеты ученика (у группы — из настроек группы); ссылка урока — если в анкете пусто
        callLink: (group ? grp?.callLink : lesson.student?.callLink) || lesson.callLink || host.callLink || teacherUser.teacherProfile?.callLink || null,
        callOwn: !!((group ? grp?.callLink : lesson.student?.callLink) || lesson.callLink || host.callLink),
        when: `${host.startsAt.toLocaleDateString(loc, { weekday: "short", day: "numeric", month: "long", timeZone: tz })}, ${hhmm(host.startsAt, tz)}`,
        durationMin: host.durationMin, status: host.status, goal: roadmap?.goal ?? null,
        templates: templates.map((x) => ({ id: x.id, label: `${x.unit.course.title} · ${x.unit.title} · ${x.title}` })),
        // «Другой урок»: курсы учителя по разделам; курсы, по которым уже занимались с этим учеником (группой), — первыми
        picker: role === "teacher" ? {
          courses: [...new Map(templates.map((x) => [x.unit.course.id, x.unit.course])).values()].map((c) => ({
            id: c.id, title: c.title, cover: c.cover ?? null,
            units: [...new Map(templates.filter((x) => x.unit.courseId === c.id).map((x) => [x.unit.id, x.unit])).values()].map((u) => ({
              id: u.id, title: u.title, topics: u.outcomes ?? [],
              lessons: templates.filter((x) => x.unitId === u.id).map((x) => ({ id: x.id, title: x.title, sub: x.subtitle ?? null, cover: x.cover ?? c.cover ?? null })),
            })),
          })),
          // пройденные и незаконченные уроки этого ученика (группы)
          progress: Object.fromEntries((await db.lessonProgress.findMany({ where: { owner: host.groupId ? `g:${host.groupId}` : `s:${host.studentId ?? "-"}` } })).map((x) => [x.templateId, x.state])),
          used: [...new Set((await db.lessonInstance.findMany({ where: { ...(host.groupId ? { groupId: host.groupId } : { studentId: host.studentId ?? "-", groupId: null }), templateId: { not: null } }, orderBy: { startsAt: "desc" }, select: { template: { select: { unit: { select: { courseId: true } } } } }, take: 200 })).map((x) => x.template!.unit.courseId))],
        } : null,
        homeHref: role === "teacher" ? "/teacher" : "/student",
        ...(role === "teacher" ? { cheers: (await getCatalog()).filter((c) => c.group === "nice") } : {}),
        addHw: (await searchParams).addhw === "1",
        initialTab: ((t) => (t === "homework" || t === "words" || t === "board" ? t : "lesson"))((await searchParams).tab),
      }}
    />
    </>
  );
}
