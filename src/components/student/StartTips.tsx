"use client";
import Link from "next/link";
import { useTransition } from "react";
import { Icon } from "@/components/Icon";
import type { IconName } from "@/components/icon-paths";
import { useT } from "@/lib/i18n/client";
import { hideTips } from "@/lib/student/actions";

export type Tip = { key: string; icon: IconName; title: string; text: string; href?: string; cta?: string; done: boolean };

/** «С чего начать» — подсказки новому ученику на главной: свои слоты в расписании, цель по словам, Telegram, маршрут и тесты. */
export function StartTips({ tips }: { tips: Tip[] }) {
  const { t } = useT();
  const [busy, start] = useTransition();
  const left = tips.filter((x) => !x.done).length;
  return (
    <section className="card starttips">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="m-0">{t("tips.title")}</h2>
        <span className="small muted">{left ? t("tips.left", { n: left }) : t("tips.allDone")}</span>
      </div>
      <div className="tipgrid">
        {tips.map((x) => (
          <div key={x.key} className={`tipitem ${x.done ? "done" : ""}`}>
            <span className="tipico"><Icon name={x.done ? "check" : x.icon} size="sm" /></span>
            <div className="grow">
              <b>{x.title}</b>
              <p className="small muted m-0 mt-1">{x.text}</p>
              {x.href && x.cta && !x.done && <Link href={x.href} className="alink small mt-2 inline-block">{x.cta} →</Link>}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-4 flex justify-end"><button className="btn secondary sm" disabled={busy} onClick={() => start(async () => { await hideTips(); })}>{t("tips.hide")}</button></div>
    </section>
  );
}
