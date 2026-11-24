import { reviewCounts } from "@/lib/review-counts";
import { AppHeader } from "@/components/AppHeader";
import { ActivityPing } from "@/components/ActivityPing";
import { Sidebar } from "@/components/Sidebar";
import { getT } from "@/lib/i18n/server";
import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { accessOf } from "@/lib/admin/features";
import { isAdmin } from "@/lib/admin/access";
import { TrialBanner } from "@/components/admin/TrialBanner";

export const dynamic = "force-dynamic";

export default async function TeacherLayout({ children }: { children: React.ReactNode }) {
  const { t } = await getT();
  const user = await requireUser("TEACHER");
  const [unread, chat, toReview, toCheck, prof, supportNew] = await Promise.all([
    db.notification.count({ where: { userId: user.id, readAt: null } }),
    db.message.count({ where: { student: { teacherId: user.id }, senderId: { not: user.id }, readAt: null } }),
    // «На проверку»: домашка, тесты и вопросы — тем же подсчётом, что и в разделе
    reviewCounts(user.id).then((r) => r.total),
    // «Финансы»: прислали чек — проверить; проведённые за месяц уроки без счёта — подтвердить оплату
    db.invoice.count({ where: { student: { teacherId: user.id }, status: "PROOF_SENT" } }).then(async (n) => n + (await db.lessonInstance.count({ where: { teacherId: user.id, billedAt: null, deductedAt: null, payLaterAt: null, startsAt: { lte: new Date() }, studentId: { not: null }, student: { status: "ACTIVE" }, OR: [{ status: "DONE" }, { status: "MISSED", charged: true }], NOT: { isTrial: true, OR: [{ price: null }, { price: { lte: 0 } }] } } }))),
    db.teacherProfile.findUnique({ where: { userId: user.id }, select: { trialUntil: true, paidUntil: true, blockedAt: true, settings: true } }),
    db.supportMessage.count({ where: { userId: user.id, fromAdmin: true, readAt: null } }),
  ]);
  // новости платформы, которых учитель ещё не видел
  const seen = (prof?.settings as { newsSeenAt?: string } | null)?.newsSeenAt;
  const news = await db.article.count({ where: { published: true, kind: { in: ["news", "digest"] }, audience: { in: ["teacher", "all"] }, ...(seen ? { updatedAt: { gt: new Date(seen) } } : {}) } });
  // владелец и администраторы платформы — без срока доступа и без плашки
  const acc = prof && !isAdmin(user) ? accessOf(prof) : null;
  const groups = [
    [
      { href: "/teacher", label: t("nav.updates"), icon: "bell" as const, count: unread },
      { href: "/teacher/schedule", label: t("nav.schedule"), icon: "cal" as const },
    ],
    [
      { href: "/teacher/students", label: t("nav.students"), icon: "users" as const },
      { href: "/teacher/chat", label: t("nav.chat"), icon: "msg" as const, count: chat },
    ],
    [
      { href: "/teacher/homework", label: t("nav.toReview"), icon: "inbox" as const, count: toReview }, // домашка, тесты и вопросы учеников
    ],
    [{ href: "/teacher/courses", label: t("nav.courses"), icon: "book" as const }],
    [{ href: "/teacher/finance", label: t("nav.finance"), icon: "coin" as const, count: toCheck }],
  ];
  // внизу меню — о платформе: новости и база знаний, тариф, поддержка
  const bottom = [
    { href: "/teacher/platform", label: t("nav.platform"), icon: "spark" as const, count: news },
    { href: "/teacher/plan", label: t("nav.plan"), icon: "card" as const },
    { href: "/teacher/support", label: t("nav.support"), icon: "msg" as const, count: supportNew },
  ];
  return (
    <>
      <ActivityPing />
      <AppHeader subtitle={t("ws.teacher")} user={user} homeHref="/teacher" profileHref="/teacher/profile" cabinet="teacher" />
      <div className="shell">
        <Sidebar groups={groups} bottom={bottom} ariaLabel={t("ws.teacher")} />
        <main className="main">{acc && <TrialBanner state={acc.state} until={acc.until?.toISOString() ?? null} />}{acc?.state === "blocked" ? null : children}</main>
      </div>
    </>
  );
}
