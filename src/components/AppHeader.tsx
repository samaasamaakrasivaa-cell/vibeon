import Link from "next/link";
import { Brand, LogoMark } from "./Logo";
import { LangSwitch } from "./LangSwitch";
import { getT } from "@/lib/i18n/server";

export async function AppHeader({
  subtitle,
  user,
  homeHref = "/",
  profileHref,
}: {
  subtitle?: string;
  user?: { name: string; lastName?: string | null };
  homeHref?: string;
  profileHref?: string;
}) {
  const { lang, t } = await getT();
  const initials = user ? ((user.name[0] ?? "") + (user.lastName?.[0] ?? "")).toUpperCase() : "";
  return (
    <header className="apptop">
      <Link href={homeHref} className="atl" aria-label="VibeOn">
        <LogoMark />
        <Brand />
        {subtitle && (
          <>
            <span className="hdiv" />
            <span className="hsub">{subtitle}</span>
          </>
        )}
      </Link>
      <div className="atr">
        <LangSwitch lang={lang} label={t("common.language")} />
        {user && (
          <Link href={profileHref ?? "#"} className="atuser" title={t("common.profile")}>
            <span className="avatar">{initials}</span>
            <span className="uname">{user.name}</span>
          </Link>
        )}
      </div>
    </header>
  );
}
