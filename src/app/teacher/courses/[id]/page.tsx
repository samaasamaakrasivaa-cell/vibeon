import Link from "next/link";
import { notFound } from "next/navigation";
import { CourseView } from "@/components/courses/CourseView";
import { Icon } from "@/components/Icon";
import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getT } from "@/lib/i18n/server";
import { hhmm } from "@/lib/time";
import type { TInfo } from "@/lib/tasks/teacher-info";

export const metadata = { title: "Курс" };

export default async function CoursePage({ params }: { params: Promise<{ id: string }> }) {
  const { t, lang } = await getT();
  const me = await requireUser("TEACHER");
  const { id } = await params;
  const c = await db.course.findUnique({
    where: { id },
    include: { units: { orderBy: { order: "asc" }, include: { lessons: { orderBy: { order: "asc" }, include: { _count: { select: { tasks: true } } } } } } },
  });
  if (!c || c.teacherId !== me.id) notFound();
  const students = await db.student.findMany({
    where: { teacherId: me.id, status: "ACTIVE" },
    orderBy: { name: "asc" },
    include: { lessons: { where: { status: "PLANNED", startsAt: { gt: new Date() } }, orderBy: { startsAt: "asc" }, take: 1 } },
  });
  const studentsOn = await db.student.count({ where: { teacherId: me.id, courseId: c.id, status: "ACTIVE" } });
  const loc = lang === "ru" ? "ru-RU" : "en-GB";
  return (
    <div className="page">
      <Link href="/teacher/courses" className="mb-4 inline-flex items-center gap-1 text-[14px] font-semibold text-accent"><Icon name="chevl" size="sm" />{t("nav.courses")}</Link>
      <CourseView
        c={{
          id: c.id, title: c.title, level: c.level, category: c.category ?? "general", cover: c.cover, color: c.color, studentsOn,
          units: c.units.map((u) => ({ id: u.id, title: u.title, collapsed: u.collapsed, lessons: u.lessons.map((l) => ({ id: l.id, title: l.title, subtitle: l.subtitle, durationMin: l.durationMin, tasks: l._count.tasks, info: (l.teacherInfo ?? {}) as TInfo })) })),
        }}
        students={students.map((s) => ({
          id: s.id, name: [s.name, s.lastName].filter(Boolean).join(" "),
          next: s.lessons[0] ? `${s.lessons[0].startsAt.toLocaleDateString(loc, { weekday: "short", day: "numeric", month: "short", timeZone: me.timezone })}, ${hhmm(s.lessons[0].startsAt, me.timezone)}` : null,
        }))}
      />
    </div>
  );
}
