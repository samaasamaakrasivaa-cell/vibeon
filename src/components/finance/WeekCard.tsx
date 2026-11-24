import Link from "next/link";
import { Icon } from "../Icon";
import { getT } from "@/lib/i18n/server";
import { rub } from "@/lib/teacher/data";
import type { WeekReport } from "@/lib/billing/weekly";

/** «Итоги прошлой недели» в «Финансах» (то же приходит уведомлением в понедельник утром). */
export async function WeekCard({ r, lang }: { r: WeekReport | null; lang: "ru" | "en" }) {
  if (!r) return null;
  const { t } = await getT();
  const R = (n: number) => rub(n, lang);
  const loc = lang === "ru" ? "ru-RU" : "en-GB";
  const d = (s: string) => new Date(`${s}T12:00:00Z`).toLocaleDateString(loc, { day: "numeric", month: "short", timeZone: "UTC" });
  // изменение к позапрошлой неделе: ▲ / ▼ и разница
  const delta = (a: number, b: number, money = true) => {
    if (a === b || (!a && !b)) return null;
    const up = a > b;
    return <span className={`wk-d ${up ? "up" : "down"}`}>{up ? "▲" : "▼"} {money ? R(Math.abs(a - b)) : Math.abs(a - b)}</span>;
  };
  const empty = !r.cur.done && !r.cur.received && !r.cur.earned;
  return (
    <section className="card wkcard mt-5" id="week">
      <div className="flex flex-wrap items-baseline gap-2">
        <h3 className="m-0 grow"><Icon name="chart" size="sm" /> {t("fin.wk.title")}</h3>
        <span className="small muted">{d(r.mon)} – {d(r.sun)} · {t("fin.wk.vs")}</span>
      </div>
      {empty ? <p className="hint m-0">{t("fin.wk.empty")}</p> : (
        <div className="wk-grid">
          <div><span>{t("fin.received")}</span><b>{R(r.cur.received)}</b>{delta(r.cur.received, r.prev.received)}</div>
          <div><span>{t("fin.wk.earned")}</span><b>{R(r.cur.earned)}</b>{delta(r.cur.earned, r.prev.earned)}</div>
          <div><span>{t("fin.wk.lessons")}</span><b>{r.cur.done}</b>{delta(r.cur.done, r.prev.done, false)}</div>
          <div><span>{t("fin.wk.cancelMove")}</span><b>{r.cur.cancelled} / {r.cur.moved}</b></div>
        </div>
      )}
      {r.waiting > 0 && (
        <div className="wk-debt">
          <span className="small"><b>{t("fin.wk.waiting", { s: R(r.waiting) })}</b>{r.debtors.length > 0 && <> · {r.debtors.map((x, i) => <span key={x.id}>{i > 0 && ", "}<Link className="alink" href={`/teacher/students/${x.id}`}>{x.name}</Link> {R(x.sum)}</span>)}</>}</span>
          <Link href="?tab=check" className="btn tinted sm">{t("fin.wk.toCheck")}</Link>
        </div>
      )}
    </section>
  );
}
