import { CoursesBoard } from "@/components/courses/CoursesBoard";
import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getT } from "@/lib/i18n/server";
import { COURSE_CATEGORIES } from "@/lib/tasks/catalog";
import Link from "next/link";
import { PlacementPanel } from "@/components/placement/PlacementPanel";
import { isOwner } from "@/lib/placement/bank";
import { env } from "@/lib/env";

export const metadata = { title: "Курсы" };

export default async function Courses({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { t, lang } = await getT();
  const me = await requireUser("TEACHER");
  const tab = (await searchParams).tab === "tests" ? "tests" : "courses";
  const tabs = (
    <nav className="tabsbar mb-6">
      <Link href="/teacher/courses" aria-current={tab === "courses" ? "page" : undefined}>{t("nav.courses")}</Link>
      <Link href="/teacher/courses?tab=tests" aria-current={tab === "tests" ? "page" : undefined}>{t("pl.tab")}</Link>
    </nav>
  );
  if (tab === "tests") {
    const [students, attempts, link] = await Promise.all([
      db.student.findMany({ where: { teacherId: me.id, archivedAt: null }, orderBy: { name: "asc" }, select: { id: true, name: true, lastName: true } }),
      db.placementAttempt.findMany({ where: { teacherId: me.id }, orderBy: { createdAt: "desc" }, take: 60, include: { student: { select: { name: true, lastName: true } } } }),
      db.placementLink.findFirst({ where: { teacherId: me.id, active: true }, orderBy: { createdAt: "desc" } }),
    ]);
    const loc = lang === "ru" ? "ru-RU" : "en-GB";
    return (
      <div className="page">
        <h1>{t("nav.courses")}</h1>
        <p className="muted mt-2 mb-6">{t("pl.tabLead")}</p>
        {tabs}
        <PlacementPanel
          owner={isOwner(me.email)} origin={env.appUrl} link={link && { code: link.code, showResult: link.showResult }}
          students={students.map((s) => ({ id: s.id, name: `${s.name} ${s.lastName ?? ""}`.trim(), initials: `${s.name[0] ?? ""}${s.lastName?.[0] ?? ""}`.toUpperCase() }))}
          rows={attempts.map((a) => ({
            id: a.id, mode: a.mode, status: a.status, level: a.level,
            who: a.mode === "student" ? `${a.student?.name ?? ""} ${a.student?.lastName ?? ""}`.trim() : a.mode === "self" ? t("pl.you") : a.guestName ?? "",
            when: (a.submittedAt ?? a.createdAt).toLocaleDateString(loc, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: me.timezone }),
          }))}
        />
      </div>
    );
  }
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
      {tabs}
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
