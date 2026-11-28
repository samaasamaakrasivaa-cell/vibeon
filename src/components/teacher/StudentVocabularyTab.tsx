import Link from "next/link";
import { Icon } from "@/components/Icon";
import { getT } from "@/lib/i18n/server";
import type { StudentVocabularyActivity } from "@/lib/teacher/vocabulary-stats";
import styles from "./StudentVocabularyTab.module.css";

export async function StudentVocabularyTab({ students }: { students: readonly StudentVocabularyActivity[] }) {
  const { t, lang } = await getT();
  if (students.length === 0) return <p className="card hint m-0">{t("inviteT.none")}</p>;

  const locale = lang === "ru" ? "ru-RU" : "en-GB";
  const number = new Intl.NumberFormat(locale);
  const date = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", timeZone: "UTC" });
  const dateWithYear = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  const formatDay = (day: string, withYear = false) => (withYear ? dateWithYear : date).format(new Date(`${day}T00:00:00Z`));

  return (
    <div className={styles.cards}>
      {students.map(({ id, name, lastName, cards, learned, lastPracticeDay, practiceDays }) => {
        const recent = practiceDays.slice(-7);
        const activeDays = recent.filter(({ count }) => count > 0).length;
        const reviewed = recent.reduce((total, { count }) => total + count, 0);
        const max = Math.max(1, ...practiceDays.map(({ count }) => count));
        const end = practiceDays[practiceDays.length - 1].day;
        const metrics = [
          { key: "total", label: t("stu.vocab.total"), value: cards, icon: "book", tone: styles.total },
          { key: "learned", label: t("stu.vocab.learned"), value: learned, icon: "check", tone: styles.learned },
          { key: "studying", label: t("stu.vocab.studying"), value: cards - learned, icon: "clock", tone: styles.studying },
        ] as const;

        return (
          <article key={id} className={`card ${styles.student}`} aria-labelledby={`vocabulary-${id}`}>
            <header className={styles.header}>
              <h2 id={`vocabulary-${id}`} className={styles.name}>
                <Link href={`/teacher/students/${id}?tab=progress`}>
                  <span>{[name, lastName].filter(Boolean).join(" ")}</span><Icon name="right" size="sm" />
                </Link>
              </h2>
              <p className={styles.last}>
                {lastPracticeDay ? <>{t("stu.vocab.last")} <time dateTime={lastPracticeDay}>
                  {formatDay(lastPracticeDay, lastPracticeDay.slice(0, 4) !== end.slice(0, 4))}
                </time></> : t("stu.vocab.noPractice")}
              </p>
            </header>

            <dl className={styles.metrics}>
              {metrics.map(({ key, label, value, icon, tone }) => (
                <div key={key} className={`${styles.metric} ${tone}`}>
                  <dt>{label}</dt>
                  <dd data-vocab-metric={key} data-value={value}>
                    <span>{number.format(value)}</span>
                    <span className={styles.icon}><Icon name={icon} size="sm" /></span>
                  </dd>
                </div>
              ))}
            </dl>

            <figure className={styles.activity}>
              <figcaption>{t("stu.vocab.activity")}</figcaption>
              <dl className={styles.week}>
                <div><dt>{t("stu.vocab.days")}</dt><dd data-vocab-metric="days" data-value={activeDays}>{t("stu.vocab.daysValue", { n: activeDays })}</dd></div>
                <div><dt>{t("stu.vocab.reviews")}</dt><dd data-vocab-metric="reviews" data-value={reviewed}>{number.format(reviewed)}</dd></div>
              </dl>
              <ol className={styles.chart} role="list" aria-label={t("stu.vocab.activity")}>
                {practiceDays.map(({ day, count }) => {
                  const label = t("stu.vocab.chartDay", { day: formatDay(day), n: number.format(count) });
                  return (
                    <li key={day} title={label} data-day={day} data-count={count}>
                      <span className="sr-only">{label}</span>
                      <i aria-hidden="true" className={count > 0 ? styles.active : undefined} style={{ height: `${count / max * 100}%` }} />
                    </li>
                  );
                })}
              </ol>
              <div className={styles.dates} aria-hidden="true"><span>{formatDay(practiceDays[0].day)}</span><span>{formatDay(end)}</span></div>
            </figure>
          </article>
        );
      })}
    </div>
  );
}
