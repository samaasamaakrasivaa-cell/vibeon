import { AppHeader } from "@/components/AppHeader";
import { Sidebar } from "@/components/Sidebar";
import { getT } from "@/lib/i18n/server";
import { requireUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default async function TeacherLayout({ children }: { children: React.ReactNode }) {
  const { t } = await getT();
  const user = await requireUser("TEACHER");
  const groups = [
    [
      { href: "/teacher", label: t("nav.updates"), icon: "bell" as const },
      { href: "/teacher/schedule", label: t("nav.schedule"), icon: "cal" as const },
    ],
    [
      { href: "/teacher/students", label: t("nav.students"), icon: "users" as const },
      { href: "/teacher/chat", label: t("nav.chat"), icon: "msg" as const },
    ],
    [
      { href: "/teacher/homework", label: t("nav.homework"), icon: "inbox" as const },
      { href: "/teacher/questions", label: t("nav.questions"), icon: "qmark" as const },
    ],
    [{ href: "/teacher/courses", label: t("nav.courses"), icon: "book" as const }],
    [{ href: "/teacher/finance", label: t("nav.finance"), icon: "coin" as const }],
  ];
  return (
    <>
      <AppHeader subtitle={t("ws.teacher")} user={user} homeHref="/teacher" profileHref="/teacher" />
      <div className="shell">
        <Sidebar groups={groups} ariaLabel={t("ws.teacher")} />
        <main className="main">{children}</main>
      </div>
    </>
  );
}
