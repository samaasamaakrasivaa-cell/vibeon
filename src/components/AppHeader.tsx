import Link from "next/link";
import { Brand, LogoMark } from "./Logo";
import { LangSwitch } from "./LangSwitch";
import { UserMenu } from "./UserMenu";
import { getT } from "@/lib/i18n/server";
import { isInternalEmail } from "@/lib/auth/cabinet";
import { db } from "@/lib/db";
import { isAdmin } from "@/lib/admin/access";
import { CabinetSwitch, type Cabinet } from "./CabinetSwitch";

export async function AppHeader({
  subtitle,
  user,
  homeHref = "/",
  profileHref,
  cabinet,
}: {
  subtitle?: string;
  user?: { name: string; lastName?: string | null; email: string; avatar?: { id: string; avatar: string | null; crown: boolean }; role?: "TEACHER" | "STUDENT"; isAdmin?: boolean; linkedUserId?: string | null };
  homeHref?: string;
  profileHref?: string;
  /** где мы сейчас — для переключателя кабинетов */
  cabinet?: "teacher" | "student" | "admin";
}) {
  const { lang, t } = await getT();
  // кабинеты этого человека: свой (учитель / ученик), администратор, привязанный второй кабинет
  const items: Cabinet[] = [];
  let linked: { label: string; email: string } | null = null;
  let shownEmail = user?.email ?? "";
  if (user && cabinet) {
    if (user.role === "TEACHER") items.push({ href: "/teacher", label: t("ws.teacher"), current: cabinet === "teacher" });
    if (user.role === "STUDENT") items.push({ href: "/student", label: t("ws.student"), current: cabinet === "student" });
    if (isAdmin({ email: user.email, isAdmin: !!user.isAdmin })) items.push({ href: "/admin", label: t("ws.admin"), current: cabinet === "admin" });
    const other = user.linkedUserId ? await db.user.findUnique({ where: { id: user.linkedUserId }, select: { role: true, email: true, linkedUserId: true } }) : null;
    // кабинет без своего входа (учитель на входе ученика): показываем почту входа
    if (other) linked = { label: other.role === "TEACHER" ? t("ws.teacher") : t("ws.student"), email: isInternalEmail(other.email) ? user.email : other.email };
    if (other && isInternalEmail(user.email)) shownEmail = other.email;
  }
  const multi = items.length > 1 || !!linked;
  return (
    <header className="apptop">
      {/* слева — логотип над меню, справа — подпись и действия ровно по краям центрального блока */}
      <Link href={homeHref} className="atbrand" aria-label="VibeOn">
        <LogoMark />
        <Brand />
      </Link>
      <div className="atbar">
        <div className="atin">
          {multi ? <CabinetSwitch items={items} linked={linked} asStudent={user?.role === "TEACHER"} /> : subtitle ? <span className="hsub">{subtitle}</span> : <span />}
          <div className="atr">
            <LangSwitch lang={lang} label={t("common.language")} />
            {user && <UserMenu name={user.name} lastName={user.lastName} email={shownEmail} profileHref={profileHref ?? homeHref} avatar={user.avatar} cabinets={multi ? items : undefined} linked={linked} asStudent={user.role === "TEACHER"} />}
          </div>
        </div>
      </div>
    </header>
  );
}
