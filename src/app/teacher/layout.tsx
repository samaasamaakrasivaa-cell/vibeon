import { homeworkFor } from "@/lib/homework";
import { AppHeader } from "@/components/AppHeader";
import { Sidebar } from "@/components/Sidebar";
import { getT } from "@/lib/i18n/server";
import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Число у «Домашки» — только то, что ученики сдали на проверку: последняя домашка ученика с ответами, ждущими проверки,
 *  или сделанная целиком, плюс пройденные placement test. Просто заданная домашка не считается. */
async function hwToReview(teacherId: string) {
  const items = await homeworkFor({ teacherId });
  const seen = new Set<string>();
  let n = 0;
  for (const h of items) {
    const sid = h.lesson.studentId ?? h.lesson.id;
    if (seen.has(sid)) continue;
    seen.add(sid);
    if (h.state === "review" && (h.needs > 0 || (h.total > 0 && h.done >= h.total))) n++;
  }
  return n + (await db.placementAttempt.count({ where: { teacherId, mode: "student", status: "submitted" } }));
}

export default async function TeacherLayout({ children }: { children: React.ReactNode }) {
  const { t } = await getT();
  const user = await requireUser("TEACHER");
  const [unread, chat, questions, hwReview, toCheck] = await Promise.all([
    db.notification.count({ where: { userId: user.id, readAt: null } }),
    db.message.count({ where: { student: { teacherId: user.id }, senderId: { not: user.id }, readAt: null } }),
    db.question.count({ where: { student: { teacherId: user.id }, askedTeacher: true, answeredAt: null } }),
    hwToReview(user.id),
    db.invoice.count({ where: { student: { teacherId: user.id }, status: "PROOF_SENT" } }),
  ]);
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
      { href: "/teacher/homework", label: t("nav.toReview"), icon: "inbox" as const, count: hwReview + questions }, // домашка, тесты и вопросы учеников
    ],
    [{ href: "/teacher/courses", label: t("nav.courses"), icon: "book" as const }],
    [{ href: "/teacher/finance", label: t("nav.finance"), icon: "coin" as const, count: toCheck }],
  ];
  return (
    <>
      <AppHeader subtitle={t("ws.teacher")} user={user} homeHref="/teacher" profileHref="/teacher/profile" />
      <div className="shell">
        <Sidebar groups={groups} ariaLabel={t("ws.teacher")} />
        <main className="main">{children}</main>
      </div>
    </>
  );
}
