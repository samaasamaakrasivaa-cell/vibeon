import { AppHeader } from "@/components/AppHeader";
import { Sidebar } from "@/components/Sidebar";
import { getT } from "@/lib/i18n/server";
import { requireUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default async function StudentLayout({ children }: { children: React.ReactNode }) {
  const { t } = await getT();
  const user = await requireUser("STUDENT");
  const groups = [
    [
      { href: "/student", label: t("nav.updates"), icon: "bell" as const },
      { href: "/student/schedule", label: t("nav.schedule"), icon: "cal" as const },
    ],
    [
      { href: "/student/lessons", label: t("nav.lessons"), icon: "book" as const },
      { href: "/student/words", label: t("nav.words"), icon: "cards" as const },
    ],
    [
      { href: "/student/route", label: t("nav.route"), icon: "route" as const },
      { href: "/student/progress", label: t("nav.progress"), icon: "chart" as const },
    ],
    [
      { href: "/student/questions", label: t("nav.questions"), icon: "qmark" as const },
      { href: "/student/messages", label: t("nav.messages"), icon: "msg" as const },
    ],
    [{ href: "/student/payments", label: t("nav.payments"), icon: "card" as const }],
    [{ href: "/student/profile", label: t("common.profile"), icon: "user" as const }],
  ];
  return (
    <>
      <AppHeader subtitle={t("ws.student")} user={user} homeHref="/student" profileHref="/student/profile" />
      <div className="shell">
        <Sidebar groups={groups} ariaLabel={t("ws.student")} />
        <main className="main">{children}</main>
      </div>
    </>
  );
}
