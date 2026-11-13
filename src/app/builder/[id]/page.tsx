import { notFound } from "next/navigation";
import type { TInfo } from "@/lib/tasks/teacher-info";
import { Builder } from "@/components/builder/Builder";
import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { getT } from "@/lib/i18n/server";
import { loadLesson } from "@/lib/teacher/builder-data";
import { hhmm } from "@/lib/time";

export const metadata = { title: "Конструктор урока" };
export const dynamic = "force-dynamic";

export default async function BuilderPage({ params }: { params: Promise<{ id: string }> }) {
  const { lang } = await getT();
  const me = await requireUser("TEACHER");
  const { id } = await params;
  const data = await loadLesson(id);
  if (!data || data.l.unit.course.teacherId !== me.id) notFound();
  const { l } = data;
  const [prof, students] = await Promise.all([
    db.teacherProfile.findUnique({ where: { userId: me.id } }),
    db.student.findMany({ where: { teacherId: me.id, status: "ACTIVE" }, orderBy: { name: "asc" }, include: { lessons: { where: { status: "PLANNED", startsAt: { gt: new Date() } }, orderBy: { startsAt: "asc" }, take: 1 } } }),
  ]);
  const loc = lang === "ru" ? "ru-RU" : "en-GB";
  return (
    <Builder
      d={{
        id: l.id, title: l.title, subtitle: l.subtitle ?? "", cover: l.cover, durationMin: l.durationMin, outcomes: l.outcomes, teacherInfo: (l.teacherInfo ?? {}) as TInfo,
        rubrics: data.rubrics, unitNo: data.unitNo, lessonNo: data.lessonNo, tasks: data.tasks,
        course: { id: l.unit.course.id, title: l.unit.course.title, cover: l.unit.course.cover },
        fav: ((prof?.settings as { favTypes?: string[] })?.favTypes) ?? ["gap", "tf"],
        share: { on: l.shareOn, token: l.shareToken }, appUrl: env.appUrl,
        students: students.map((s) => ({ id: s.id, name: [s.name, s.lastName].filter(Boolean).join(" "), next: s.lessons[0] ? `${s.lessons[0].startsAt.toLocaleDateString(loc, { weekday: "short", day: "numeric", month: "short", timeZone: me.timezone })}, ${hhmm(s.lessons[0].startsAt, me.timezone)}` : null })),
      }}
    />
  );
}
