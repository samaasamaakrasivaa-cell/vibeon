import { AppHeader } from "@/components/AppHeader";
import { ActivityPing } from "@/components/ActivityPing";
import { Sidebar } from "@/components/Sidebar";
import { getT } from "@/lib/i18n/server";
import { requireUser } from "@/lib/auth/session";
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
  // Учёба: уроки, слова и тестирование. Прогресс: темы, маршрут, результаты тестов, награды и обратная связь.
  // профиль — по аватарке справа вверху, помощь — внизу
  const groups = [
    [
      { href: "/student", label: t("nav.home"), icon: "home" as const, count: unread },
      { href: "/student/schedule", label: t("nav.schedule"), icon: "cal" as const },
    ],
    [
      { href: "/student/lessons", label: t("nav.study"), icon: "book" as const, also: ["/student/words", "/student/tests"] },
      { href: "/student/progress", label: t("nav.myProgress"), icon: "chart" as const, also: ["/student/route", "/student/test"] },
      { href: "/student/messages", label: t("nav.chat"), icon: "msg" as const, count: msgs + answers, also: ["/student/questions", "/student/teacher"] },
    ],
    [{ href: "/student/payments", label: t("nav.payments"), icon: "card" as const, count: bills }],
  ];

  return (
    <>
      <ActivityPing />
      <AppHeader subtitle={t("ws.student")} user={{ ...user, avatar: me ? { id: me.id, avatar: me.avatar, crown: me.awards.length > 0 } : undefined }} homeHref="/student" profileHref="/student/profile" cabinet="student" />
      <div className="shell">
        <Sidebar groups={groups} ariaLabel={t("ws.student")} bottom={help ? [{ href: "/student/help", label: t("nav.help"), icon: "info" as const }] : []} />
        <main className="main">{isDemoEmail(user.email) && <DemoBar />}{children}</main>
      </div>
    </>
  );
}
