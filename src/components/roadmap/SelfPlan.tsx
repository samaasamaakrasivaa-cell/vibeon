"use client";
// План самостоятельной работы: что, как часто и сколько минут; ссылки — только на поиск (адреса не выдумываются).
import { useT } from "@/lib/i18n/client";
import type { SelfStudy } from "@/lib/ai/route-core";
import { Icon } from "../Icon";

const COLOR: Record<string, string> = { listening: "#0A84FF", reading: "#34C759", speaking: "#FF9500", writing: "#AF52DE", vocabulary: "#FF375F", grammar: "#5856D6" };
const link = (skill: string, q: string) => (skill === "listening" && /video|youtube|ted/i.test(q) ? `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}` : `https://www.google.com/search?q=${encodeURIComponent(q)}`);

export function SelfPlan({ plan, lessons, lessonMin, student }: { plan: SelfStudy; lessons: number; lessonMin: number; student?: boolean }) {
  const { t } = useT();
  const h = (m: number) => (m >= 60 ? `${Math.floor(m / 60)} ${t("ss.h")}${m % 60 ? ` ${m % 60} ${t("ss.min")}` : ""}` : `${m} ${t("ss.min")}`);
  return (
    <div className="ssplan">
      <div className="ssbar">
        <div><b>{lessons} × {lessonMin} {t("ss.min")}</b><span>{t("ss.lessons")}</span></div>
        <div><b>{h(plan.minutes_per_week)}</b><span>{student ? t("ss.selfYou") : t("ss.self")}</span></div>
        <div><b>≈ {Math.round(plan.minutes_per_week / 7)} {t("ss.min")}</b><span>{t("ss.perDay")}</span></div>
      </div>
      <ul className="sslist">
        {plan.items.map((x, i) => (
          <li key={i}>
            <i style={{ background: COLOR[x.skill] ?? "#8E8E93" }} />
            <div className="grow">
              <div className="flex flex-wrap items-baseline gap-x-2"><b>{x.activity}</b><span className="small muted">{t(`ss.k.${x.skill}`)}</span></div>
              {x.how && <div className="small">{x.how}</div>}
              {!student && x.why && <div className="small muted">{x.why}</div>}
              {x.search && <a className="small alink" href={link(x.skill, x.search)} target="_blank" rel="noopener noreferrer">{t("ss.find")}: {x.search} ↗</a>}
            </div>
            <span className="ssfreq"><b>{x.times_per_week}×</b><span>{x.minutes} {t("ss.min")}</span></span>
          </li>
        ))}
      </ul>
      {plan.tips.length > 0 && <ul className="rbul small mt-2">{plan.tips.map((x, i) => <li key={i}>{x}</li>)}</ul>}
      <p className="hint mb-0 mt-2"><Icon name="info" size="sm" /> {t("ss.basis")}</p>
    </div>
  );
}
