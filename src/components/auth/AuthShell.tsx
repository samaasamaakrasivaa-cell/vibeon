import { LangSwitch } from "../LangSwitch";
import { Brand, LogoMark } from "../Logo";
import { getT } from "@/lib/i18n/server";

/** Общая рамка экранов входа: язык справа сверху, логотип, карточка по центру. */
export async function AuthShell({ children, brand = true, wordmark = true }: { children: React.ReactNode; brand?: boolean; wordmark?: boolean }) {
  const { lang, t } = await getT();
  return (
    <>
      <div className="authtop">
        <LangSwitch lang={lang} label={t("common.language")} />
      </div>
      <main className="authwrap">
        {brand && (
          <div className="authbrand">
            <LogoMark size={64} />
            {wordmark && <Brand />}
          </div>
        )}
        {children}
      </main>
    </>
  );
}
