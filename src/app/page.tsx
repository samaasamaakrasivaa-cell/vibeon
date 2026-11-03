import Link from "next/link";
import { AppHeader } from "@/components/AppHeader";
import { Icon } from "@/components/Icon";
import { LogoMark } from "@/components/Logo";
import { getT } from "@/lib/i18n/server";

export default async function Home() {
  const { t } = await getT();
  return (
    <>
      <AppHeader />
      <main className="main">
        <div className="page" style={{ maxWidth: 640 }}>
          <div className="card mt-6 flex flex-col items-center gap-5 py-12 text-center">
            <LogoMark size={64} />
            <h1>{t("home.title")}</h1>
            <p className="muted m-0">{t("home.lead")}</p>
            <div className="flex w-full max-w-[340px] flex-col gap-3">
              <Link href="/teacher" className="btn primary lg block"><Icon name="class" />{t("home.teacher")}</Link>
              <Link href="/student" className="btn tinted lg block"><Icon name="user" />{t("home.student")}</Link>
              <Link href="/ui" className="btn secondary block"><Icon name="palette" />{t("home.ui")}</Link>
              <a href="/api/health" className="btn plain block">{t("home.health")}</a>
            </div>
          </div>
        </div>
      </main>
    </>
  );
}
