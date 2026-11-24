import { AppHeader } from "@/components/AppHeader";
import { ActivityPing } from "@/components/ActivityPing";
import { Sidebar } from "@/components/Sidebar";
import { getT } from "@/lib/i18n/server";
import { requireUser } from "@/lib/auth/session";
import { aboutFilled, cleanAbout } from "@/lib/teacher/about-data";
import { isDemoEmail } from "@/lib/auth/cabinet";
import { DemoBar } from "@/components/teacher/DemoBar";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function StudentLayout({ children }: { children: React.ReactNode }) {
  const { t } = await getT();
  const user = await requireUser("STUDENT");
  const [unread, msgs, answers, bills, me, help] = await Promise.all([
    db.notification.count({ where: { userId: user.id, readAt: null } }),
    db.message.count({ where: { student: { userId: user.id }, senderId: { not: user.id }, readAt: null } }),
    db.notification.count({ where: { userId: user.id, kind: "answer", readAt: null } }),
    db.invoice.count({ where: { student: { userId: user.id }, status: "SENT" } }),
    db.student.findUnique({ where: { userId: user.id }, select: { id: true, avatar: true, awards: { where: { kind: "title", pinned: true, onMain: true, OR: [{ until: null }, { until: { gt: new Date() } }] }, select: { id: true }, take: 1 } } }),
    db.article.count({ where: { published: true, audience: { in: ["student", "all"] } } }),
  ]);
  // «Мой преподаватель» — если учитель заполнил анкету и разрешил показывать её ученикам
  const tAbout = await db.student.findUnique({ where: { userId: user.id }, select: { teacher: { select: { about: true } } } });
  const showTeacher = (() => { const a = cleanAbout(tAbout?.teacher.about); return a.show !== false && aboutFilled(a); })();
  const groups = [
    [
      { href: "/student", label: t("nav.updates"), icon: "bell" as const, count: unread },
      { href: "/student/schedule", label: t("nav.schedule"), icon: "cal" as const },
    ],
    [
      { href: "/student/lessons", label: t("nav.lessons"), icon: "book" as const },
      { href: "/student/words", label: t("nav.words"), icon: "cards" as const },
    ],
    [
      { href: "/student/route", label: t("nav.route"), icon: "route" as const },
      { href: "/student/progress", label: t("nav.progressAwards"), icon: "chart" as const },
    ],
    [
      { href: "/student/questions", label: t("nav.questions"), icon: "qmark" as const, count: answers },
      { href: "/student/messages", label: t("nav.messages"), icon: "msg" as const, count: msgs },
    ],
    [{ href: "/student/payments", label: t("nav.payments"), icon: "card" as const, count: bills }],
    [...(showTeacher ? [{ href: "/student/teacher", label: t("nav.myTeacher"), icon: "user" as const }] : []), { href: "/student/profile", label: t("common.profile"), icon: "user" as const }, ...(help ? [{ href: "/student/help", label: t("nav.help"), icon: "info" as const }] : [])],
  ];
  return (
    <>
      <ActivityPing />
      <AppHeader subtitle={t("ws.student")} user={{ ...user, avatar: me ? { id: me.id, avatar: me.avatar, crown: me.awards.length > 0 } : undefined }} homeHref="/student" profileHref="/student/profile" cabinet="student" />
      <div className="shell">
        <Sidebar groups={groups} ariaLabel={t("ws.student")} />
        <main className="main">{isDemoEmail(user.email) && <DemoBar />}{children}</main>
      </div>
    </>
  );
}
