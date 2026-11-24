import { SkillBars } from "@/components/roadmap/RoadmapEditor";
import type { getT } from "@/lib/i18n/server";
import { progressData } from "@/lib/roadmap/progress";
import { SKILL_COLOR, SKILL_NAME, SKILLS as RM_SKILLS, txt } from "@/lib/roadmap/cefr";

type TT = Awaited<ReturnType<typeof getT>>["t"];

/** Статистика ученика: часы по месяцам, навыки по последнему тесту, динамика навыков. Одинаково у учителя (анкета → Прогресс) и у ученика (Мой прогресс → Статистика). */
export async function ProgressStats({ studentId, tz, lang, t, topics }: { studentId: string; tz: string; lang: "ru" | "en"; t: TT; topics: number }) {
  const p = await progressData(studentId, tz);
  const loc = lang === "ru" ? "ru-RU" : "en-GB";
  const mx = Math.max(1, ...p.months.map(([, h]) => h));
  const last = p.tests[p.tests.length - 1], prev = p.tests[p.tests.length - 2];
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="card">
        <h3 className="mt-0">{t("pr.hours")}</h3>
        <div className="bars6">{p.months.map(([k, h]) => (
          <div key={k} className="barcol"><span className="small">{Math.round(h)}</span><span className="bar" style={{ height: `${(h / mx) * 120 + 4}px` }} /><span className="small muted">{new Date(`${k}-15`).toLocaleDateString(loc, { month: "short" })}</span></div>
        ))}</div>
        <p className="hint mb-0">{t("pr.topics", { n: topics })}</p>
      </section>
      <section className="card">
        <h3 className="mt-0">{t("pr.skills")}</h3>
        {last ? <>
          <div className="mb-3 small muted">{last.level} · {last.at.toLocaleDateString(loc, { day: "numeric", month: "long", timeZone: tz })}</div>
          <SkillBars skills={last.skills} prev={prev?.skills} />
        </> : <p className="hint m-0">{t("rm.noTest")}</p>}
      </section>
      {p.tests.length > 1 && (
        <section className="card lg:col-span-2">
          <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="m-0">{t("pr.dynamics")}</h3>
            <span className="small muted">{p.tests.map((x) => `${x.level ?? ""} ${x.at.toLocaleDateString(loc, { day: "numeric", month: "short", timeZone: tz })}`.trim()).join("  →  ")}</span>
          </div>
          <div className="skilldyn">
            {RM_SKILLS.filter((k) => p.tests.some((x) => x.skills[k] !== undefined)).map((k) => (
              <div key={k} className="sdcol"><div className="sdbars">{p.tests.map((x, i) => <span key={i} className="sdbar" title={`${x.at.toLocaleDateString(loc, { timeZone: tz })}: ${x.skills[k] ?? "—"}%`}><em>{x.skills[k] ?? "—"}</em><i style={{ height: `${(x.skills[k] ?? 0) * 1.2}px`, background: SKILL_COLOR[k], opacity: 0.45 + (0.55 * (i + 1)) / p.tests.length }} /></span>)}</div><span className="small">{txt(SKILL_NAME[k], lang)}</span></div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

