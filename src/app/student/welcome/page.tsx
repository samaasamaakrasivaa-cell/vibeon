import Link from "next/link";
import { Icon } from "@/components/Icon";
import { getT } from "@/lib/i18n/server";
import { requireUser } from "@/lib/auth/session";
import { tgEnabled } from "@/lib/notify/telegram";
import { TgConnect } from "@/components/TgConnect";

export const metadata = { title: "Подключите Telegram" };

/** Шаг 2 из 2 после анкеты: подключение Telegram. */
export default async function Welcome() {
  const { t } = await getT();
  const me = await requireUser("STUDENT");
  const bot = tgEnabled();
  return (
    <div className="page" style={{ maxWidth: 560 }}>
      <section className="card">
        <div className="bigicon"><Icon name="telegram" /></div>
        <h1 className="text-center">{t("tg.title")}</h1>
        <p className="muted mt-3 mb-0">{t("tg.lead")}</p>
        <div className="tglist">
          <div><Icon name="clock" size="sm" /><span>{t("tg.i1")}</span></div>
          <div><Icon name="card" size="sm" /><span>{t("tg.i2")}</span></div>
          <div><Icon name="msg" size="sm" /><span>{t("tg.i3")}</span></div>
        </div>
        <details className="how"><summary>ⓘ {t("tg.connect")}</summary>{t("tg.how")}</details>
        <div className="mt-5 flex flex-col gap-3">
          {me.telegramChatId ? <div className="alert ok">✓ {t("nf.tgOn")}</div> : bot ? <TgConnect /> : <p className="hint m-0 text-center">{t("nf.tgOff")}</p>}
          <Link href="/student" className="btn secondary w-full">{me.telegramChatId ? t("nf.toCabinet") : t("tg.later")}</Link>
        </div>
        <div className="steps mt-4">{t("ob.step", { n: 2 })}</div>
      </section>
    </div>
  );
}
