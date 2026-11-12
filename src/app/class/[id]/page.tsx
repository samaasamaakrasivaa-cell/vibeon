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
  const { lesson, role } = acc;
  const teacherUser = await db.user.findUnique({ where: { id: lesson.teacherId ?? "" }, include: { teacherProfile: true } });
  if (!teacherUser) notFound();
  const data = lesson.templateId ? await loadLesson(lesson.templateId) : null;
  const [answersRows, hw, words, messages, templates] = await Promise.all([
    db.answer.findMany({ where: { lessonInstanceId: id } }),
    db.homework.findUnique({ where: { lessonInstanceId: id } }),
    lesson.studentId ? db.word.findMany({ where: { studentId: lesson.studentId, sourceLessonId: id }, orderBy: { createdAt: "asc" } }) : [],
    lesson.studentId ? db.message.findMany({ where: { studentId: lesson.studentId }, orderBy: { createdAt: "desc" }, take: 50 }) : [],
    role === "teacher" ? db.lessonTemplate.findMany({ where: { unit: { course: { teacherId: teacherUser.id } } }, include: { unit: { include: { course: true } } }, orderBy: [{ unit: { course: { order: "asc" } } }, { unit: { order: "asc" } }, { order: "asc" }] }) : [],
  ]);
  const answers: Answers = Object.fromEntries(answersRows.map((a) => [a.taskId, a.payload as Record<string, unknown>]));
  const statuses = Object.fromEntries(answersRows.map((a) => [a.taskId, a.status]));
  const reviews = Object.fromEntries(answersRows.filter((a) => a.teacherReview).map((a) => [a.taskId, a.teacherReview as Review]));
  // черновики проверки ИИ видит только учитель
  const aiDrafts = role === "teacher" ? Object.fromEntries(answersRows.filter((a) => a.aiDraft).map((a) => [a.taskId, a.aiDraft as AiCheck])) : {};
  const lessonWords = (data?.tasks ?? []).filter((x) => x.type === "wordset").flatMap((x) => { const p = parse("wordset", x.content); return p.kind === "wordset" ? p.items : []; });
  const tz = user.timezone;
  const loc = lang === "ru" ? "ru-RU" : "en-GB";
  const roadmap = lesson.studentId ? await db.roadmap.findFirst({ where: { studentId: lesson.studentId, approvedAt: { not: null } }, orderBy: { createdAt: "desc" } }) : null;
  const board = (lesson.board as { pages?: BObj[][] })?.pages ?? [[]];
  return (
    <ClassRoom
      d={{
        id, templateId: lesson.templateId, role, me: { id: user.id, name: user.name },
        teacher: { id: teacherUser.id, name: teacherUser.name, lastName: teacherUser.lastName },
        student: lesson.student ? { id: lesson.student.id, userId: lesson.student.userId, name: lesson.student.name, lastName: lesson.student.lastName, level: lesson.student.level, course: lesson.student.course } : null,
        title: data?.l.title ?? null,
        crumbs: data ? `${data.l.unit.course.title} · Unit ${data.unitNo} · Lesson ${data.lessonNo}` : null,
        course: data ? { title: data.l.unit.course.title, cover: data.l.unit.course.cover } : null,
        rubrics: data?.rubrics ?? [], tasks: (data?.tasks ?? []).filter((x) => role === "teacher" || !x.options?.teacherOnly), /* заметки «только учителю» ученику не отдаём */ answers, statuses, reviews, aiDrafts,
        ...(role === "teacher" && data?.l.teacherInfo ? { teacherInfo: data.l.teacherInfo as TInfo } : {}),
        live: (lesson.live ?? {}) as LiveState, board,
        homework: { extraTaskIds: hw?.extraTaskIds ?? [], wordTraining: hw?.wordTraining ?? [], teacherComment: hw?.teacherComment ?? null },
        lessonWords, words: words.map((w) => ({ id: w.id, word: w.word, translation: w.translation, example: w.example, level: w.level })),
        messages: messages.reverse().map((m) => ({ id: m.id, text: m.text, by: m.senderId, at: m.createdAt.toISOString() })),
        note: lesson.note, studentNote: lesson.studentNote,
        callLink: lesson.callLink || lesson.student?.callLink || teacherUser.teacherProfile?.callLink || null,
        when: `${lesson.startsAt.toLocaleDateString(loc, { weekday: "short", day: "numeric", month: "long", timeZone: tz })}, ${hhmm(lesson.startsAt, tz)}`,
        durationMin: lesson.durationMin, status: lesson.status, goal: roadmap?.goal ?? null,
        templates: templates.map((x) => ({ id: x.id, label: `${x.unit.course.title} · ${x.unit.title} · ${x.title}` })),
        homeHref: role === "teacher" ? "/teacher" : "/student",
        addHw: (await searchParams).addhw === "1",
        initialTab: ((t) => (t === "homework" || t === "words" || t === "board" ? t : "lesson"))((await searchParams).tab),
      }}
    />
  );
}
