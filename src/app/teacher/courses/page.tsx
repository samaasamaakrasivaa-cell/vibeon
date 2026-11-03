import { CoursesBoard } from "@/components/courses/CoursesBoard";
import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getT } from "@/lib/i18n/server";
import { COURSE_CATEGORIES } from "@/lib/tasks/catalog";

export const metadata = { title: "Курсы" };

export default async function Courses() {
  const { t } = await getT();
  const me = await requireUser("TEACHER");
  const [courses, prof] = await Promise.all([
    db.course.findMany({ where: { teacherId: me.id }, orderBy: { order: "asc" }, include: { units: { select: { _count: { select: { lessons: true } } } } } }),
    db.teacherProfile.findUnique({ where: { userId: me.id } }),
  ]);
  const saved = ((prof?.settings as { categoryOrder?: string[] })?.categoryOrder ?? []).filter((k) => COURSE_CATEGORIES.some((c) => c[0] === k));
  const order = [...saved, ...COURSE_CATEGORIES.map((c) => c[0]).filter((k) => !saved.includes(k))];
  return (
    <div className="page">
      <h1>{t("nav.courses")}</h1>
      <p className="muted mt-2 mb-6">{t("crs.lead")}</p>
      <CoursesBoard
        order={order}
        courses={courses.map((c) => ({
          id: c.id, title: c.title, level: c.level, category: c.category ?? "general", cover: c.cover, color: c.color,
          units: c.units.length, lessons: c.units.reduce((a, u) => a + u._count.lessons, 0),
        }))}
      />
    </div>
  );
}
