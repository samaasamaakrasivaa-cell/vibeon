import Link from "next/link";
import { Brand, LogoMark } from "./Logo";
import { LangSwitch } from "./LangSwitch";
import { UserMenu } from "./UserMenu";
import { getT } from "@/lib/i18n/server";

export async function AppHeader({
  subtitle,
  user,
  homeHref = "/",
  profileHref,
}: {
  subtitle?: string;
  user?: { name: string; lastName?: string | null; email: string };
  homeHref?: string;
  profileHref?: string;
}) {
  const { lang, t } = await getT();
  return (
    <header className="apptop">
      {/* слева — логотип над меню, справа — подпись и действия ровно по краям центрального блока */}
      <Link href={homeHref} className="atbrand" aria-label="VibeOn">
        <LogoMark />
        <Brand />
      </Link>
      <div className="atbar">
        <div className="atin">
          {subtitle ? <span className="hsub">{subtitle}</span> : <span />}
          <div className="atr">
            <LangSwitch lang={lang} label={t("common.language")} />
            {user && <UserMenu name={user.name} lastName={user.lastName} email={user.email} profileHref={profileHref ?? homeHref} />}
          </div>
        </div>
      </div>
    </header>
  );
}
