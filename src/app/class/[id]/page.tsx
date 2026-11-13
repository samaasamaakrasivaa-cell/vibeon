import { notFound } from "next/navigation";
import type { TInfo } from "@/lib/tasks/teacher-info";
import { ClassRoom, type AiCheck, type Review } from "@/components/class/ClassRoom";
import type { BObj } from "@/components/class/Board";
import type { Answers } from "@/components/tasks/store";
import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getT } from "@/lib/i18n/server";
import { classAccess, type LiveState } from "@/lib/live/access";
import { loadLesson } from "@/lib/teacher/builder-data";
import { parse } from "@/lib/tasks/parse";
import { hhmm } from "@/lib/time";

export const metadata = { title: "Урок" };
export const dynamic = "force-dynamic";

/** Класс: урок в реальном времени для учителя и ученика. */
export default async function ClassPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string; addhw?: string }> }) {
  const { lang } = await getT();
  const user = await requireUser();
  const { id } = await params;
  const acc = await classAccess(id, user);
  if (!acc) notFound();
  const { lesson, role, host, slot, group } = acc;
  const teacherUser = await db.user.findUnique({ where: { id: lesson.teacherId ?? "" }, include: { teacherProfile: true } });
  if (!teacherUser) notFound();
  const data = host.templateId ? await loadLesson(host.templateId) : null;
  // групповое занятие: учитель видит уроки всех учеников, ученик — только свой
  const ids = role === "teacher" ? slot.map((x) => x.id) : [lesson.id];
  const [allRows, hw, allWords, messages, templates, grp] = await Promise.all([
    db.answer.findMany({ where: { lessonInstanceId: { in: ids } } }),
    db.homework.findUnique({ where: { lessonInstanceId: lesson.id } }),
    db.word.findMany({ where: { sourceLessonId: { in: ids } }, orderBy: { createdAt: "asc" } }),
    lesson.studentId && !group ? db.message.findMany({ where: { studentId: lesson.studentId }, orderBy: { createdAt: "desc" }, take: 50 }) : [],
    role === "teacher" ? db.lessonTemplate.findMany({ where: { unit: { course: { teacherId: teacherUser.id } } }, include: { unit: { include: { course: true } } }, orderBy: [{ unit: { course: { order: "asc" } } }, { unit: { order: "asc" } }, { order: "asc" }] }) : [],
    group && (host.groupId ?? lesson.groupId) ? db.group.findUnique({ where: { id: (host.groupId ?? lesson.groupId)! }, select: { title: true, callLink: true, messages: { orderBy: { createdAt: "desc" }, take: 60 } } }) : null,
  ]);
  // чат группового урока: имена всех участников
  const chatNames: Record<string, string> = Object.fromEntries(slot.filter((x) => x.student?.userId).map((x) => [x.student!.userId!, x.student!.name]));
  // ответы, проверки и слова — по ученикам
  const pack = (sid: string | null) => {
    const rows = allRows.filter((a) => a.studentId === sid);
    return {
      answers: Object.fromEntries(rows.map((a) => [a.taskId, a.payload as Record<string, unknown>])) as Answers,
      statuses: Object.fromEntries(rows.map((a) => [a.taskId, a.status])) as Record<string, string>,
      reviews: Object.fromEntries(rows.filter((a) => a.teacherReview).map((a) => [a.taskId, a.teacherReview as Review])),
      aiDrafts: role === "teacher" ? Object.fromEntries(rows.filter((a) => a.aiDraft).map((a) => [a.taskId, a.aiDraft as AiCheck])) : {},
      words: allWords.filter((w) => w.studentId === sid).map((w) => ({ id: w.id, word: w.word, translation: w.translation, example: w.example, level: w.level })),
    };
  };
  const members = slot.filter((x) => x.student).map((x) => ({ sid: x.student!.id, instanceId: x.id, userId: x.student!.userId, name: [x.student!.name, x.student!.lastName].filter(Boolean).join(" ") }));
  const answersRows = allRows.filter((a) => a.studentId === lesson.studentId);
  const words = allWords.filter((w) => w.studentId === lesson.studentId);
  const answers: Answers = Object.fromEntries(answersRows.map((a) => [a.taskId, a.payload as Record<string, unknown>]));
  const statuses = Object.fromEntries(answersRows.map((a) => [a.taskId, a.status]));
  const reviews = Object.fromEntries(answersRows.filter((a) => a.teacherReview).map((a) => [a.taskId, a.teacherReview as Review]));
  // черновики проверки ИИ видит только учитель
  const aiDrafts = role === "teacher" ? Object.fromEntries(answersRows.filter((a) => a.aiDraft).map((a) => [a.taskId, a.aiDraft as AiCheck])) : {};
  const lessonWords = (data?.tasks ?? []).filter((x) => x.type === "wordset").flatMap((x) => { const p = parse("wordset", x.content); return p.kind === "wordset" ? p.items : []; });
  const tz = user.timezone;
  const loc = lang === "ru" ? "ru-RU" : "en-GB";
  const roadmap = lesson.studentId && !group ? await db.roadmap.findFirst({ where: { studentId: lesson.studentId, approvedAt: { not: null } }, orderBy: { createdAt: "desc" } }) : null;
  const board = (host.board as { pages?: BObj[][] })?.pages ?? [[]];
  return (
    <ClassRoom
      d={{
        id, templateId: host.templateId, role, me: { id: user.id, name: user.name },
        ...(group ? { group: { title: grp?.title ?? members.map((m) => m.name.split(" ")[0]).join(", "), members: role === "teacher" ? members : members.filter((m) => m.instanceId === lesson.id) } } : {}),
        ...(group && role === "teacher" ? { byStudent: Object.fromEntries(members.map((m) => [m.sid, pack(m.sid)])) } : {}),
        teacher: { id: teacherUser.id, name: teacherUser.name, lastName: teacherUser.lastName },
        student: lesson.student && !(group && role === "teacher") ? { id: lesson.student.id, userId: lesson.student.userId, name: lesson.student.name, lastName: lesson.student.lastName, level: lesson.student.level, course: lesson.student.course } : null,
        title: data?.l.title ?? null,
        crumbs: data ? `${data.l.unit.course.title} · Unit ${data.unitNo} · Lesson ${data.lessonNo}` : null,
        course: data ? { title: data.l.unit.course.title, cover: data.l.unit.course.cover } : null,
        rubrics: data?.rubrics ?? [], tasks: (data?.tasks ?? []).filter((x) => role === "teacher" || !x.options?.teacherOnly).map((x) => (role === "teacher" || (!x.options?.teacherKey && !x.options?.help?.hidden) ? x : { ...x, options: { ...x.options, teacherKey: undefined, help: x.options?.help?.hidden ? undefined : x.options?.help } })), /* заметки «только учителю», ответы для учителя и скрытые Useful phrases ученику не отдаём */ answers, statuses, reviews, aiDrafts,
        ...(role === "teacher" && data?.l.teacherInfo ? { teacherInfo: data.l.teacherInfo as TInfo } : {}),
        live: (host.live ?? {}) as LiveState, board,
        homework: { extraTaskIds: hw?.extraTaskIds ?? [], wordTraining: hw?.wordTraining ?? [], teacherComment: hw?.teacherComment ?? null },
        lessonWords, words: words.map((w) => ({ id: w.id, word: w.word, translation: w.translation, example: w.example, level: w.level })),
        messages: (group ? [...(grp?.messages ?? [])] : messages).reverse().map((m) => ({ id: m.id, text: m.text, by: m.senderId, at: m.createdAt.toISOString() })),
        ...(group ? { chatNames } : {}),
        note: host.note, studentNote: role === "student" ? lesson.studentNote : group ? null : lesson.studentNote,
        callLink: lesson.callLink || host.callLink || (group ? grp?.callLink : lesson.student?.callLink) || teacherUser.teacherProfile?.callLink || null,
        when: `${host.startsAt.toLocaleDateString(loc, { weekday: "short", day: "numeric", month: "long", timeZone: tz })}, ${hhmm(host.startsAt, tz)}`,
        durationMin: host.durationMin, status: host.status, goal: roadmap?.goal ?? null,
        templates: templates.map((x) => ({ id: x.id, label: `${x.unit.course.title} · ${x.unit.title} · ${x.title}` })),
        homeHref: role === "teacher" ? "/teacher" : "/student",
        addHw: (await searchParams).addhw === "1",
        initialTab: ((t) => (t === "homework" || t === "words" || t === "board" ? t : "lesson"))((await searchParams).tab),
      }}
    />
  );
}
