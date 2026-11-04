import Link from "next/link";
import { Icon } from "@/components/Icon";
import { getT } from "@/lib/i18n/server";
import { env } from "@/lib/env";

export const metadata = { title: "Подключите Telegram" };

/** Шаг 2 из 2 после анкеты: подключение Telegram. Сам бот — этап 10. */
export default async function Welcome() {
  const { t } = await getT();
  const bot = !!env.telegramBot;
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
          <button className="btn primary lg w-full" disabled={!bot} title={bot ? undefined : t("tg.soon")}>
            <Icon name="telegram" />{t("tg.connect")}
          </button>
          {!bot && <p className="hint m-0 text-center">{t("tg.soon")}</p>}
          <Link href="/student" className="btn secondary w-full">{t("tg.later")}</Link>
        </div>
        <div className="steps mt-4">{t("ob.step", { n: 2 })}</div>
      </section>
    </div>
  );
}
