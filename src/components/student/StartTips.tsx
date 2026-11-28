"use client";
import Link from "next/link";
import { useId, useState, useTransition } from "react";
import { Icon } from "@/components/Icon";
import type { IconName } from "@/components/icon-paths";
import { useT } from "@/lib/i18n/client";
import { hideTips } from "@/lib/student/actions";
import styles from "./StartTips.module.css";

export type Tip = { key: string; icon: IconName; title: string; text: string; href?: string; cta?: string; done?: boolean; locked?: string; keepLink?: boolean };

function LockHint({ label, reason }: { label: string; reason: string }) {
  const id = useId();
  const [visibility, setVisibility] = useState<"open" | "dismissed">();

  return (
    <span
      className={styles.lock}
      data-visibility={visibility}
      onPointerLeave={() => setVisibility((value) => value === "dismissed" ? undefined : value)}
    >
      <button
        type="button"
        className={styles.lockButton}
        aria-label={label}
        aria-describedby={id}
        onClick={() => setVisibility((value) => value === "open" ? "dismissed" : "open")}
        onBlur={() => setVisibility(undefined)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            setVisibility("dismissed");
            event.stopPropagation();
          }
        }}
      >
        <Icon name="lock" size="sm" />
      </button>
      <span id={id} role="tooltip" className={styles.tooltip}>{reason}</span>
    </span>
  );
}

export function StartTips({ tips }: { tips: Tip[] }) {
  const { t } = useT();
  const [busy, start] = useTransition();
  const titleId = useId();
  const complete = tips.filter((tip) => tip.done).length;
  return (
    <section className={`card ${styles.panel}`} aria-labelledby={titleId}>
      <header className={styles.header}>
        <h2 id={titleId}>{t("tips.title")}</h2>
        <div className={styles.progress}>
          <span>{complete < tips.length ? t("tips.progress", { done: complete, total: tips.length }) : t("tips.allDone")}</span>
          <div className={styles.segments} aria-hidden="true">
            {tips.map((tip) => <span key={tip.key} data-complete={tip.done || undefined} />)}
          </div>
        </div>
      </header>
      <ol className={styles.steps} role="list">
        {tips.map((tip) => (
          <li
            key={tip.key}
            className={styles.step}
            data-start-tip={tip.key}
            data-state={tip.locked ? "locked" : tip.done ? "done" : "ready"}
          >
            <span className={styles.icon}>
              <Icon name={tip.icon} />
              {tip.done && (
                <span className={styles.check}>
                  <Icon name="check" size="sm" />
                  <span className="sr-only">{t("st.doneMark")}</span>
                </span>
              )}
            </span>
            <div className={styles.copy}>
              <h3>{tip.title}</h3>
              <p>{tip.text}</p>
            </div>
            {tip.locked ? (
              <LockHint label={`${tip.title}. ${t("tips.locked")}`} reason={tip.locked} />
            ) : tip.href && tip.cta && (!tip.done || tip.keepLink) && (
              <Link href={tip.href} className={`btn secondary sm ${styles.action}`}>{tip.cta}</Link>
            )}
          </li>
        ))}
      </ol>
      <div className={styles.footer}>
        <button type="button" className="btn secondary sm" disabled={busy} onClick={() => start(async () => { await hideTips(); })}>
          {t("tips.hide")}
        </button>
      </div>
    </section>
  );
}
