import { AppHeader } from "@/components/AppHeader";
import { Sidebar } from "@/components/Sidebar";
import { getT } from "@/lib/i18n/server";
import { requireAdmin } from "@/lib/admin/access";

export const dynamic = "force-dynamic";
export const metadata = { title: "Администратор" };

/** Кабинет администратора платформы: учителя, тарифы, финансы, база знаний. */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const { t } = await getT();
  const user = await requireAdmin();
  const groups = [
    [{ href: "/admin", label: t("adm.nav.overview"), icon: "chart" as const }],
    [
      { href: "/admin/teachers", label: t("adm.nav.teachers"), icon: "users" as const },
      { href: "/admin/plans", label: t("adm.nav.plans"), icon: "card" as const },
    ],
    [{ href: "/admin/finance", label: t("adm.nav.finance"), icon: "coin" as const }],
    [{ href: "/admin/kb", label: t("adm.nav.kb"), icon: "book" as const }],
  ];
  return (
    <>
      <AppHeader subtitle={t("ws.admin")} user={user} homeHref="/admin" profileHref={user.role === "TEACHER" ? "/teacher/profile" : "/student/profile"} cabinet="admin" />
      <div className="shell">
        <Sidebar groups={groups} ariaLabel={t("ws.admin")} />
        <main className="main">{children}</main>
      </div>
    </>
  );
}
