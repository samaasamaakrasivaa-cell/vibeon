import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { Icon } from "@/components/Icon";
import { SectionTabs, StudyHead } from "@/components/student/SectionTabs";
import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { homeworkFor } from "@/lib/homework";
import { getT } from "@/lib/i18n/server";
import { currentStudentLesson, nextStudentLesson } from "@/lib/student/next-lesson";

export const metadata = { title: "Мои уроки" };
export const dynamic = "force-dynamic";

const pageSize = 25;
const lessonFields = {
  id: true, startsAt: true, status: true, isTrial: true,
  template: { select: {
    title: true, subtitle: true, cover: true,
    unit: { select: { title: true, course: { select: { title: true, cover: true } } } },
  } },
} as const satisfies Prisma.LessonInstanceSelect;

type Lesson = Prisma.LessonInstanceGetPayload<{ select: typeof lessonFields }>;
type Homework = Awaited<ReturnType<typeof homeworkFor>>[number];

export default async function MyLessons({ searchParams }: { searchParams: Promise<{ c?: string; p?: string }> }) {
  const { t, lang } = await getT();
  const me = await requireUser("STUDENT");
  const student = await db.student.findUnique({ where: { userId: me.id }, select: { id: true } });
  if (!student) return null;

  const search = await searchParams;
  const page = Math.max(1, Math.min(100_000, Math.floor(Number(search.p)) || 1));
  const courses = await db.course.findMany({
    where: { units: { some: { lessons: { some: { instances: { some: { studentId: student.id, status: { not: "CANCELLED" } } } } } } } },
    select: { id: true, title: true }, orderBy: [{ title: "asc" }, { id: "asc" }],
  });
  const course = courses.find(({ id }) => id === search.c)?.id;
  const href = (p: number, id = course) => {
    const query = new URLSearchParams();
    if (id) query.set("c", id);
    if (p > 1) query.set("p", String(p));
    return `/student/lessons${query.size ? `?${query}` : ""}`;
  };
  const now = new Date();
  const [current, next, latest] = await Promise.all([
    currentStudentLesson(me.id, now, course),
    nextStudentLesson(me.id, now, course),
    db.lessonInstance.findFirst({
      where: { studentId: student.id, status: "DONE", ...(course ? { template: { unit: { courseId: course } } } : {}) },
      select: { id: true }, orderBy: [{ startsAt: "desc" }, { id: "desc" }],
    }),
  ]);
  const focus = current ?? next;
  const scope = { studentId: student.id, ...(course ? { template: { unit: { courseId: course } } } : {}) };
  const [planned, historyPage, upcoming] = await Promise.all([
    page === 1 && focus ? db.lessonInstance.findFirst({
      where: { ...scope, id: focus.id, status: "PLANNED" }, select: lessonFields,
    }) : null,
    db.lessonInstance.findMany({
      where: {
        ...scope,
        OR: [
          { status: { in: ["DONE", "MISSED"] } },
          { status: "PLANNED", startsAt: { lte: now }, ...(focus ? { id: { not: focus.id } } : {}) },
        ],
      },
      select: lessonFields, orderBy: [{ startsAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * pageSize, take: pageSize + 1,
    }),
    page === 1 ? db.lessonInstance.findMany({
      where: { ...scope, ...(focus ? { id: { not: focus.id } } : {}), status: "PLANNED", startsAt: { gt: now } },
      select: lessonFields, orderBy: [{ startsAt: "asc" }, { id: "asc" }], take: pageSize,
    }) : [],
  ]);
  const history = historyPage.slice(0, pageSize).filter(({ id }) => id !== planned?.id);
  const lessons = planned ? [planned, ...history] : history;
  const work = new Map((await homeworkFor({ studentId: student.id }, [...lessons, ...upcoming].map(({ id }) => id)))
    .map((homework) => [homework.lesson.id, homework]));
  const formatDate = new Intl.DateTimeFormat(lang === "ru" ? "ru-RU" : "en-GB", {
    day: "numeric", month: "short", year: "numeric", timeZone: me.timezone,
  });
  const formatTime = new Intl.DateTimeFormat(lang === "ru" ? "ru-RU" : "en-GB", {
    hour: "2-digit", minute: "2-digit", timeZone: me.timezone,
  });

  function homeworkBadge(homework?: Homework) {
    if (!homework) return null;
    if (homework.needsRevision) return <span className="pill orange">{t("stl.hwRevise")}</span>;
    if (homework.total > homework.done) return <span className="pill orange">{t("stl.hwRemaining")}</span>;
    if (homework.total === 0) return <span className="pill blue">{t(homework.words ? "stl.hwPractice" : "stl.hwMaterials")}</span>;
    return (
      <>
        <span className={`pill ${homework.state === "review" ? "orange" : "green"}`}>{t(homework.state === "review" ? "stl.hwSent" : "stl.hwCompleted")}</span>
        {homework.words > 0 && <span className="pill blue">{t("stl.hwPractice")}</span>}
      </>
    );
  }

  function row(lesson: Lesson, future: boolean) {
    const h = work.get(lesson.id);
    const active = lesson.id === planned?.id;
    const title = lesson.template?.title ?? t(lesson.isTrial ? "sch.trial" : "cls.lesson");
    const courseLabel = lesson.template?.unit.course.title;
    const cover = lesson.template?.cover || lesson.template?.unit.course.cover;
    const classHref = `/class/${lesson.id}`;
    const openHomework = h && (active || lesson.id === latest?.id) && (h.needsRevision || h.done < h.total || h.words > 0 || h.total === 0);
    return (
      <li key={lesson.id} className="row flex-wrap">
        <time className="min-w-[92px]" dateTime={lesson.startsAt.toISOString()}>
          <b className="block">{formatDate.format(lesson.startsAt)}</b>
          <span className="small muted">{formatTime.format(lesson.startsAt)}</span>
        </time>
        {cover && <span className="lcover has" style={{ backgroundImage: `url(${cover})`, cursor: "inherit" }} aria-hidden="true" />}
        <div className="min-w-0 grow basis-[180px]">
          <div className="t break-words">{title}</div>
          {courseLabel && <div className="s break-words">{[courseLabel, lesson.template?.unit.title, lesson.template?.subtitle].filter(Boolean).join(" · ")}</div>}
          <div className="mt-2 flex flex-wrap gap-2">
            {(active || future) && <span className="pill blue">{t(lesson.id === current?.id ? "today.live" : "sts.upcoming")}</span>}
            {lesson.status === "MISSED" && <span className="pill grey">{t("sch.st.missed")}</span>}
            {homeworkBadge(h)}
          </div>
        </div>
        <div className="study-actions flex flex-wrap gap-2">
          <Link href={classHref} prefetch={false} className={`btn ${active ? "primary" : "secondary"} sm`}><Icon name="class" size="sm" />{t(active ? "stl.enterLesson" : "sts.openLesson")}</Link>
          {openHomework && <Link href={`${classHref}?tab=homework`} prefetch={false} className="btn tinted sm"><Icon name="clip" size="sm" />{t("st.doHwBig")}</Link>}
        </div>
      </li>
    );
  }

  return (
    <div className="page">
      <StudyHead active="lessons" />
      {(courses.length > 1 || course) && <SectionTabs items={[
        { href: href(1, ""), label: t("stl.allCourses"), active: !course },
        ...courses.map(({ id, title }) => ({ href: href(1, id), label: title, active: id === course })),
      ]} />}
      {lessons.length > 0 ? <ul className="list m-0 p-0">{lessons.map((lesson) => row(lesson, false))}</ul> :
        <div className="card"><p className="hint m-0">{t("stl.none")}</p></div>}
      {(page > 1 || historyPage.length > pageSize) && <nav className="mt-4 flex flex-wrap gap-2">
        {page > 1 && <Link href={href(page - 1)} className="btn secondary sm"><Icon name="chevl" size="sm" />{t("stl.newer")}</Link>}
        {historyPage.length > pageSize && <Link href={href(page + 1)} className="btn secondary sm">{t("stl.older")}<Icon name="right" size="sm" /></Link>}
      </nav>}
      {upcoming.length > 0 && <section className="mt-6">
        <h2>{t("stl.moreUpcoming")}</h2>
        <ul className="list m-0 p-0">{upcoming.map((lesson) => row(lesson, true))}</ul>
        <Link href="/student/schedule" className="btn secondary sm mt-4">{t("nav.schedule")}</Link>
      </section>}
    </div>
  );
}
