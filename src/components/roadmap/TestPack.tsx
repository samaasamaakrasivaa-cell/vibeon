"use client";
// «Комплект разбора»: всё по placement test в одном месте (ошибки по темам, таблица тем, письмо и говорение,
// отчёт учителя) + динамика по аккаунту. Каждый раздел сворачивается.
import { useT } from "@/lib/i18n/client";
import type { AccountStats, TestPack as Pack } from "@/lib/roadmap/pack";
import { Icon } from "../Icon";
import { StepHead } from "./RouteBrief";

const VERDICT: Record<string, string> = { gap: "red", part: "orange", own: "green" };

function Sec({ title, n, children, open }: { title: string; n?: number | string; children: React.ReactNode; open?: boolean }) {
  return (
    <details className="tpack-sec" open={open}>
      <summary><span className="grow">{title}</span>{n !== undefined && n !== "" && <span className="pill grey">{n}</span>}<Icon name="chevd" size="sm" /></summary>
      <div className="tpack-body">{children}</div>
    </details>
  );
}

function Errors({ groups }: { groups: Pack["grammarErrors"] }) {
  const { t } = useT();
  if (!groups.length) return <p className="hint m-0">{t("tp.noErrors")}</p>;
  return (
    <div className="flex flex-col gap-3">
      {groups.map((g) => (
        <div key={g.topic}>
          <div className="small font-bold">{g.topic} <span className="muted">· {g.level} · {t("tp.nErr", { n: g.items.length })}</span></div>
          <ul className="tpack-err">
            {g.items.map((x, i) => (
              <li key={i}><span className="q">{x.q}</span> <span className="text-bad">{x.given || "—"}</span> → <span className="text-ok">{x.right}</span>{x.explain && <div className="muted">{x.explain}</div>}</li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function Marks({ m, max = 3 }: { m: { name: string; v: number | null; note: string }[]; max?: number }) {
  return (
    <table className="tpack-tbl"><tbody>
      {m.map((x) => <tr key={x.name}><td>{x.name}</td><td className="num"><b>{x.v ?? "—"}</b>/{max}</td><td className="muted">{x.note}</td></tr>)}
    </tbody></table>
  );
}

export function TestPackView({ pack, stats }: { pack: Pack | null; stats: AccountStats }) {
  const { t } = useT();
  const totalErr = pack ? pack.grammarErrors.reduce((a, g) => a + g.items.length, 0) : 0;
  const vErr = pack ? pack.vocabErrors.reduce((a, g) => a + g.items.length, 0) : 0;
  const gaps = pack?.grammarTopics.filter((x) => x.verdict === "gap" || x.verdict === "part") ?? [];
  const hwPct = stats.homework.assigned8w ? Math.round((stats.homework.done8w / stats.homework.assigned8w) * 100) : null;
  return (
    <section className="card tpack">
      <StepHead n={2} title={t("tp.title")} sub={t("tp.hint")} right={pack && <span className="small muted">{t("tp.from", { d: new Date(pack.date).toLocaleDateString("ru-RU", { day: "numeric", month: "long" }) })}</span>} />
      {!pack ? <p className="hint">{t("tp.none")}</p> : (
        <>
          <Sec title={t("tp.skills")} open>
            <table className="tpack-tbl"><tbody>
              {pack.skills.map((s) => <tr key={s.key}><td>{s.name}</td><td className="num"><b>{s.step ?? "—"}</b></td><td className="num muted">{s.pct !== null ? `${s.pct}%` : ""}</td></tr>)}
            </tbody></table>
          </Sec>
          {pack.grammarTopics.length > 0 && (
            <Sec title={t("tp.topics")} n={gaps.length ? t("tp.nGaps", { n: gaps.length }) : ""}>
              <div className="flex flex-wrap gap-1.5">
                {[...pack.grammarTopics].sort((a, b) => ["gap", "part", "own", null].indexOf(a.verdict) - ["gap", "part", "own", null].indexOf(b.verdict)).map((x) => (
                  <span key={x.name + x.level} className={`pill ${VERDICT[x.verdict ?? ""] ?? "grey"}`} title={`${x.c}/${x.n}`}>{x.name} · {x.level}</span>
                ))}
              </div>
              <span className="hint">{t("tp.topicsHint")}</span>
            </Sec>
          )}
          {pack.families.length > 0 && (
            <Sec title={t("tp.families")}>
              <table className="tpack-tbl"><tbody>{pack.families.map((f) => <tr key={f.name}><td>{f.name}</td><td className="num">{f.c}/{f.n}</td><td className="num muted">{f.n ? Math.round((f.c / f.n) * 100) : 0}%</td></tr>)}</tbody></table>
            </Sec>
          )}
          <Sec title={t("tp.gErr")} n={totalErr}><Errors groups={pack.grammarErrors} /></Sec>
          <Sec title={t("tp.vErr")} n={vErr}><Errors groups={pack.vocabErrors} /></Sec>
          {(pack.reading.length > 0 || pack.listening.length > 0) && (
            <Sec title={t("tp.texts")}>
              <table className="tpack-tbl"><tbody>
                {pack.reading.map((x, i) => <tr key={`r${i}`}><td>{t("tp.reading")} {x.level}</td><td className="num">{x.c}/{x.n}</td></tr>)}
                {pack.listening.map((x, i) => <tr key={`l${i}`}><td>{t("tp.listening")} {x.level}</td><td className="num">{x.c}/{x.n}</td></tr>)}
              </tbody></table>
            </Sec>
          )}
          {pack.writing && (
            <Sec title={t("tp.writing", { l: pack.writing.level })}>
              <Marks m={pack.writing.marks} max={pack.max} />
              {pack.writing.note && <p className="small mb-0">{pack.writing.note}</p>}
              {pack.writing.text && <blockquote className="tpack-text">{pack.writing.text}</blockquote>}
            </Sec>
          )}
          {pack.speaking && (
            <Sec title={t("tp.speaking", { l: pack.speaking.level })}>
              <Marks m={pack.speaking.marks} max={pack.max} />
              {pack.speaking.note && <p className="small mb-0">{pack.speaking.note}</p>}
            </Sec>
          )}
          <Sec title={t("tp.report")} n={pack.report.sent ? t("tp.sent") : ""}>
            {([["strong", "tp.strong"], ["work", "tp.work"], ["plan", "tp.plan"], ["comment", "tp.comment"]] as const).map(([k, key]) => pack.report[k] && (
              <div key={k} className="mb-2"><div className="small font-bold">{t(key)}</div><div className="small" style={{ whiteSpace: "pre-wrap" }}>{pack.report[k]}</div></div>
            ))}
          </Sec>
          <div className="mt-2 flex flex-wrap gap-3 small">
            <a className="alink" href={`/teacher/placement/${pack.attemptId}`}>{t("tp.openReview")}</a>
            <a className="alink" href={`/teacher/placement/${pack.attemptId}/report`}>{t("tp.openReport")}</a>
          </div>
        </>
      )}
      <Sec title={t("tp.dyn")}>
        <table className="tpack-tbl"><tbody>
          <tr><td>{t("tp.lessons")}</td><td className="num"><b>{stats.lessons.total}</b></td><td className="muted">{t("tp.lessons4w", { n: stats.lessons.last4w, h: stats.lessons.hours4w })}</td></tr>
          <tr><td>{t("tp.hw")}</td><td className="num"><b>{hwPct !== null ? `${hwPct}%` : "—"}</b></td><td className="muted">{t("tp.hw8w", { d: stats.homework.done8w, n: stats.homework.assigned8w })}</td></tr>
          <tr><td>{t("tp.self")}</td><td className="num" colSpan={2}>{stats.minutesPerWeek.map((m) => `${m}`).join(" · ")} <span className="muted">{t("tp.selfUnit")}</span></td></tr>
          {stats.tests.length > 0 && <tr><td>{t("tp.tests")}</td><td colSpan={2}>{stats.tests.map((x) => `${x.date.slice(5).split("-").reverse().join(".")} ${x.level ?? "—"}`).join(" → ")}</td></tr>}
        </tbody></table>
        <span className="hint">{t("tp.dynHint")}</span>
      </Sec>
    </section>
  );
}
