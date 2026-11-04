import Link from "next/link";
import { Icon } from "@/components/Icon";
import { SkillBars } from "@/components/roadmap/RoadmapEditor";
import { PacePicker, RouteMap, StageTestButton } from "@/components/roadmap/RouteParts";
import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getT } from "@/lib/i18n/server";
import { skillNote, SKILL_COLOR, SKILL_NAME, SKILLS, txt, type Skill, type Stage } from "@/lib/roadmap/cefr";
import { etaRange, fmtHM, lessonsWord, paceKey, paceLabel, stageMath } from "@/lib/roadmap/math";
import { roadmapView } from "@/lib/roadmap/progress";

export const metadata = { title: "Мой маршрут" };
const TABS = ["ov", "a", "now", "next", "fin"] as const;

export default async function MyRoute({ searchParams }: { searchParams: Promise<{ tab?: string; wk?: string; i?: string }> }) {
  const { t, lang } = await getT();
  const me = await requireUser("STUDENT");
  const s = await db.student.findUnique({ where: { userId: me.id } });
  if (!s) return null;
  const sp = await searchParams;
  const wk = Math.max(0, Math.min(8, Number(sp.wk) || 0));
  const v = await roadmapView(s.id, me.timezone, wk);
  const openTest = v.checkpoints.find((c) => c.status === "assigned");

  if (!v.r || !v.r.approvedAt) {
    return (
      <div className="page" style={{ maxWidth: 900 }}>
        <h1 className="mb-4">{t("nav.route")}</h1>
        {openTest && <TestBanner id={openTest.id} entry={openTest.kind === "entry"} t={t} />}
        <section className="card rtempty"><Icon name="route" /><div><b>{t("rt.notYet")}</b><div className="small muted">{t("rt.notYetSub")}</div></div></section>
      </div>
    );
  }
  const r = v.r;
  const L = lang;
  const stages = v.stages.map((x) => ({ ...x, title: txt(x.title, L) }));
  const tab = sp.tab === "stage" ? "stage" : (TABS as readonly string[]).includes(sp.tab ?? "") ? sp.tab! : "ov";
  const ini = `${s.name[0] ?? ""}${s.lastName?.[0] ?? ""}`.toUpperCase();
  const dated = !!r.deadline && r.showDate;
  const eta = (h: number) => (dated ? etaRange(h, v.paceS, L, v.lessonMin) : t("rt.hoursOf", { h: fmtHM(h, L) }));
  const entry = v.checkpoints.find((c) => c.kind === "entry" && c.status === "done");
  const doneTests = v.checkpoints.filter((c) => c.status === "done");
  const lastTest = doneTests[doneTests.length - 1];
  const tabLink = (k: string, label: string) => <Link key={k} href={`?tab=${k}`} aria-current={tab === k ? "page" : undefined}>{label}</Link>;
  const res = (c?: (typeof v.checkpoints)[number]) => (c?.results ?? {}) as { skills?: Partial<Record<Skill, number>>; weak?: [string, string][]; strong?: [string, string][] };

  // ── недельный отчёт
  const W = v.week, N = v.norm;
  const rows = [[t("rt.lessons"), W.les, N.les, ""], [t("nav.homework"), W.hw, N.hw, t("rt.minDay", { n: Math.round((N.hw * 60) / 7) })], [t("rt.words"), W.wd, N.wd, t("rt.minDay", { n: Math.round((N.wd * 60) / 7) })]] as const;
  const mx = Math.max(0.5, ...rows.map((x) => Math.max(x[1], x[2])));
  const power = Math.min(1, (W.les + W.hw + W.wd) / Math.max(0.1, N.les + N.hw + N.wd));
  const lowHw = W.hw < N.hw * 0.8 || W.wd < N.wd * 0.8;
  const fmtDay = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString(L === "ru" ? "ru-RU" : "en-GB", { day: "numeric", month: "short" });

  const stageCard = (i: number, final: boolean) => {
    const st = stages[i];
    if (!st) return null;
    const m = stageMath(stages, v.done, i, v.paceS, v.lessonMin);
    const reached = m.inS >= st.hours - 0.01;
    return (
      <section className="card stagecard">
        <div className="mb-2 flex flex-wrap items-center gap-3">
          <span className="lvlbig">{st.lvl}</span>
          <div className="grow"><b className="text-[18px]">{st.title}</b><div className="small muted">{t("rt.doneOf", { a: fmtHM(m.inS, L), b: st.hours })}</div></div>
          {st.passed ? <span className="pill green">✓ {t("rt.passed", { n: st.passed.score })}</span> : <StageTestButton stage={i} enabled={reached} final={final} />}
        </div>
        <div className="stbar"><div style={{ width: `${(m.inS / st.hours) * 100}%` }} /></div>
        <div className="mgrid">
          <div><b>≈ {lessonsWord(m.lessons, L)}</b><span>{t("rt.left")}</span></div>
          <div><b>{fmtHM(m.self * (2 / 3), L)}</b><span>{t("rt.hwShort")}</span></div>
          <div><b>{fmtHM(m.self / 3, L)}</b><span>{t("rt.wordsShort")}</span></div>
          <div className="dlbox"><b>{m.leftAll ? eta(m.leftAll) : t("rt.done")}</b><span>{dated ? t("rt.approx") : t("rt.toPoint")}</span></div>
        </div>
        <p className="small muted mb-0">{t("rt.recalc")}</p>
        {(st.feel ?? []).length > 0 && <div className="feel"><div className="plab">{t("rt.feel")}</div>{st.feel!.map((g, k) => <div key={k} className="can"><Icon name="check" size="sm" /><span>{txt(g, L)}</span></div>)}</div>}
        <div className="plab mt-4">{t("rt.inside")}</div>
        <div className="blocks">
          {([["rm.grammar", st.grammar, "#007AFF"], ["rm.vocab", st.vocabulary, "#FF9500"], ["rm.canYou", st.skills, "#AF52DE"]] as const).map(([k, list, c]) => list.length > 0 && (
            <div key={k} className="blk2"><div className="blkh"><i style={{ background: c }} /><b>{t(k)}</b></div>{list.map((g, j) => <div key={j} className="can"><Icon name="check" size="sm" /><span>{txt(g, L)}</span></div>)}</div>
          ))}
        </div>
      </section>
    );
  };

  return (
    <div className="page" style={{ maxWidth: 980 }}>
      <h1 className="mb-4">{t("nav.route")}</h1>
      {openTest && <TestBanner id={openTest.id} entry={openTest.kind === "entry"} t={t} />}
      <nav className="tabsbar fit mb-5">{tabLink("ov", t("rt.tab.ov"))}{tabLink("a", t("rt.tab.a"))}{tabLink("now", t("rt.tab.now"))}{tabLink("next", t("rt.tab.next"))}{tabLink("fin", t("rt.tab.fin"))}</nav>

      {tab === "ov" && (
        <div className="flex flex-col gap-5">
          <section className="goalcard">
            <div><div className="small opacity-80">{t("rt.yourGoal")}</div><div className="gtitle">{r.goal}</div>{dated && r.deadline && <div className="small opacity-90">{t("rt.by", { d: r.deadline.toLocaleDateString(L === "ru" ? "ru-RU" : "en-GB", { month: "long", year: "numeric" }) })}</div>}</div>
            <div className="text-right"><div className="small opacity-80">{dated ? t("rt.atPace") : t("rt.reachWith")}</div><div className="geta">{dated ? eta(v.st.left) : fmtHM(v.st.left, L)}</div><div className="small opacity-80">{dated ? t("rt.leftH", { h: fmtHM(v.st.left, L) }) : t("rt.ofStudy")}</div>{!dated && <div className="small mt-1 font-semibold">{t("rt.weeksAt", { n: Math.max(1, Math.round(v.st.left / v.perWeek)), pace: paceLabel(v.paceS, L) })}</div>}</div>
          </section>
          <section className="card">
            <div className="mb-3 flex items-center gap-2"><span className="tk-aiico"><Icon name="trophyI" size="sm" /></span><b>{t("rt.ach")}</b></div>
            <div className="achgrid">
              {[["📚", "#0A84FF", v.achievements.lessons, t("rt.achLessons")], ["⏱", "#34C759", `${v.achievements.hours} ${L === "ru" ? "ч" : "h"}`, t("rt.achHours")], ["⭐", "#FF9500", v.achievements.words, t("rt.achWords")], ["🏔", "#AF52DE", `${v.achievements.pct}%`, t("rt.achWay")]].map(([em, c, n, l], i) => (
                <div key={i} className="achc" style={{ ["--c" as string]: c as string, animationDelay: `${i * 90}ms` }}><span className="achi">{em}</span><div><b>{n}</b><span>{l}</span></div></div>
              ))}
            </div>
            {v.lateWeeks > 0 && (
              <div className="anarow mt-4"><Icon name="clockI" size="sm" /><div className="grow">
                <div>{t("rt.lateWhy", { n: v.lateWeeks })}{W.cancelled ? ` ${t("rt.cancelled", { n: W.cancelled })}` : ""}{lowHw ? ` ${t("rt.lowHw")}` : ""}</div>
                <div className="mt-2 flex flex-wrap gap-2"><Link className="btn primary sm" href="/student/schedule">{t("rt.makeup")}</Link><Link className="btn secondary sm" href="/student/lessons">{t("rt.doHw")}</Link><Link className="btn secondary sm" href="/student/words">{t("rt.practise")}</Link></div>
              </div></div>
            )}
          </section>
          <div className="mtnwrap"><RouteMap stages={stages} done={v.done} start={r.fromLevel ?? "A"} ini={ini} label={t("rt.youHere")} units={(r.units as { title: string }[]).map((u) => u.title)} ci={v.st.ci} /></div>

          <section className="card booster">
            <Rocket power={power} parts={[[W.les / Math.max(0.01, N.les), "#0A84FF"], [W.hw / Math.max(0.01, N.hw), "#34C759"], [W.wd / Math.max(0.01, N.wd), "#AF52DE"]]} />
            <div className="grow">
              <b className="text-[18px]">{t("rt.booster")}</b><div className="small muted mb-3">{t("rt.boosterF")}</div>
              {rows.map(([l, a, b], i) => (
                <div key={i} className="brow"><i style={{ background: ["#0A84FF", "#34C759", "#AF52DE"][i] }} /><span className="bl">{l}</span><span className="bbar"><span style={{ width: `${Math.min(100, (a / Math.max(0.01, b)) * 100)}%`, background: ["#0A84FF", "#34C759", "#AF52DE"][i] }} /></span><span className="bv">{fmtHM(a, L)} <small>/ {fmtHM(b, L)}</small></span></div>
              ))}
              <div className="mt-2 small">{t("rt.power")} <b>{Math.round(power * 100)}%</b></div>
            </div>
          </section>

          <div className="plaque"><Icon name="chart" size="sm" /><div className="grow"><b>{t("rt.report")}</b><span className="small muted block">{fmtDay(W.from)} – {fmtDay(W.to)}</span></div>
            <div className="flex gap-1">
              <Link href={`?tab=ov&wk=${wk + 1}`} aria-label={t("rt.prevWeek")} className={`iconbtn ${wk >= 8 ? "pointer-events-none opacity-40" : ""}`}><Icon name="chevl" size="sm" /></Link>
              <Link href={`?tab=ov&wk=${Math.max(0, wk - 1)}`} aria-label={t("rt.nextWeek")} className={`iconbtn ${wk === 0 ? "pointer-events-none opacity-40" : ""}`}><Icon name="right" size="sm" /></Link>
            </div>
          </div>
          <section className="card">
            <div className="blegend"><span><i className="me" />{t("rt.studied")}</span><span><i className="nm" />{t("rt.norm")}</span></div>
            <div className="rgrid">
              {rows.map(([l, a, b, d], i) => {
                const p = a / Math.max(0.01, b), z = p >= 1.15 ? "above" : p >= 0.95 ? "ok" : p >= 0.6 ? "low" : "crit";
                return (
                  <div key={i} className={`rbox ${z}`}>
                    <div className="rbars"><div className="rb"><span className="rv">{fmtHM(a, L)}</span><span className="rbar me" style={{ height: `${(a / mx) * 120}px` }} /></div><div className="rb"><span className="rv muted">{fmtHM(b, L)}</span><span className="rbar nm" style={{ height: `${(b / mx) * 120}px` }} /></div></div>
                    <div className="rl"><b>{l}</b><span className="small muted">{d || " "}</span><span className={`zone ${z}`}>{t(`rt.z.${z}`)}</span></div>
                  </div>
                );
              })}
            </div>
            {lowHw && <div className="aianswer mt-4"><span className="tk-aiico"><Icon name="spark" size="sm" /></span><div><b>{t("rt.lowTitle")}</b><p className="m-0 mt-1">{t("rt.lowTip")}</p></div></div>}
            <h3 className="mb-2 mt-5">{t("rt.newPace")}</h3>
            <PacePicker left={v.st.left} current={paceKey(v.paceS)} teacher={paceKey(v.paceT)} lessonMin={v.lessonMin} showDate={dated} />
          </section>
        </div>
      )}

      {tab === "a" && (
        <div className="flex flex-col gap-4">
          {entry ? (
            <>
              <section className="card">
                <div className="mb-3 flex items-center gap-3"><h3 className="m-0 grow">{t("rt.entryRes")}</h3><span className="small muted">{entry.takenAt?.toLocaleDateString(L === "ru" ? "ru-RU" : "en-GB", { day: "numeric", month: "long", year: "numeric" })}</span><span className="lvlbig">{entry.level}</span></div>
                <SkillBars skills={res(entry).skills ?? {}} />
              </section>
              <h3 className="m-0">{t("rt.showed")}</h3>
              <section className="card blocks">
                {SKILLS.filter((k) => res(entry).skills?.[k] !== undefined).map((k) => (
                  <div key={k} className="blk2"><div className="blkh"><i style={{ background: SKILL_COLOR[k] }} /><b>{txt(SKILL_NAME[k], L)}</b><span className="small muted">{res(entry).skills![k]}%</span></div><div className="small">{txt(skillNote(k, res(entry).skills![k]!), L)}</div></div>
                ))}
              </section>
              {(res(entry).weak ?? []).length > 0 && <section className="card"><b>{t("rm.weak")}</b><div className="mt-2 flex flex-wrap gap-1.5">{res(entry).weak!.map((w, i) => <span key={i} className="pill orange">{txt(w, L)}</span>)}</div></section>}
            </>
          ) : <section className="card"><p className="hint m-0">{t("rt.noEntry", { lvl: r.fromLevel ?? "—" })}</p></section>}
        </div>
      )}

      {tab === "now" && (
        <div className="flex flex-col gap-4">
          <div className="nowme"><Icon name="route" size="sm" /><span>{t("rt.youAre", { p: v.achievements.pct })}</span></div>
          <div className="nowcols">
            {([[t("rt.toNext"), stages[v.st.ci]?.lvl, stageMath(stages, v.done, v.st.ci, v.paceS, v.lessonMin), "near"], [t("rt.toGoal"), r.goal, null, "goal"]] as const).map(([title, lvl, m, cls]) => {
              const left = m ? m.rest : v.st.left;
              const pct = m ? Math.round((m.inS / (stages[v.st.ci]?.hours || 1)) * 100) : v.achievements.pct;
              const w = left / v.perWeek;
              return (
                <section key={cls} className={`card nowcol ${cls}`}>
                  <div className="mb-2 flex items-center gap-3"><span className="lvlbig">{lvl}</span><div><b>{title}</b><div className="small muted">{t("rt.pctDone", { n: pct })}</div></div></div>
                  <div className="stbar"><div style={{ width: `${pct}%` }} /></div>
                  <div className="mgrid three"><div><b>≈ {lessonsWord(Math.round(w * v.paceS.lessons), L)}</b><span>{t("rt.left")}</span></div><div><b>{fmtHM((w * v.paceS.min * 7) / 60, L)}</b><span>{t("rt.self")}</span></div><div className="dlbox"><b>{eta(left)}</b><span>{dated ? t("rt.approx") : cls === "goal" ? t("rt.toGoalShort") : t("rt.toPoint")}</span></div></div>
                </section>
              );
            })}
          </div>
          {lastTest && <section className="card"><h3 className="mt-0">{t("rt.bySkills")}</h3><SkillBars skills={res(lastTest).skills ?? {}} prev={doneTests.length > 1 ? res(doneTests[doneTests.length - 2]).skills : undefined} /></section>}
          <section className="card"><h3 className="mt-0">{t("rt.ahead")}</h3>{stageCard(v.st.ci, v.st.ci === stages.length - 1)}</section>
        </div>
      )}

      {(tab === "next" || tab === "stage") && stageCard(tab === "stage" ? Math.max(0, Math.min(stages.length - 1, Number(sp.i) || 0)) : v.st.ci, (tab === "stage" ? Number(sp.i) : v.st.ci) === stages.length - 1)}
      {tab === "fin" && (
        <>
          {stageCard(stages.length - 1, true)}
          {(r.criteria as (string | [string, string])[]).length > 0 && <section className="card mt-4"><h3 className="mt-0">{t("rm.criteria")}</h3>{(r.criteria as (string | [string, string])[]).map((c, i) => <div key={i} className="can"><Icon name="targetI" size="sm" /><span>{txt(c, L)}</span></div>)}</section>}
        </>
      )}
    </div>
  );
}

function TestBanner({ id, entry, t }: { id: string; entry: boolean; t: Awaited<ReturnType<typeof getT>>["t"] }) {
  return (
    <div className="testbanner mb-5"><span className="tk-aiico"><Icon name="targetI" size="sm" /></span><div className="grow"><b>{entry ? t("rt.entryWaiting") : t("rt.sliceWaiting")}</b><div className="small opacity-90">{t("rt.testTime")}</div></div><Link className="btn light" href={`/student/test/${id}`}>{t("rt.startTest")}</Link></div>
  );
}

function Rocket({ power, parts }: { power: number; parts: [number, string][] }) {
  return (
    <svg viewBox="0 0 120 200" className="rocket" aria-hidden="true">
      <defs>
        <linearGradient id="rkb" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#FFFFFF" /><stop offset=".55" stopColor="#F2F4F8" /><stop offset="1" stopColor="#D9DEE7" /></linearGradient>
        <linearGradient id="rkf" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#FFD60A" /><stop offset=".5" stopColor="#FF9F0A" /><stop offset="1" stopColor="#FF375F" stopOpacity="0" /></linearGradient>
        <linearGradient id="rkw" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#64D2FF" /><stop offset="1" stopColor="#0A84FF" /></linearGradient>
      </defs>
      <path d="M60,8 C80,24 88,50 88,78 L88,128 Q60,138 32,128 L32,78 C32,50 40,24 60,8Z" fill="url(#rkb)" stroke="#D9DEE7" />
      <circle cx="60" cy="58" r="11" fill="url(#rkw)" stroke="#FFFFFF" strokeWidth="3" />
      {parts.map(([f, c], k) => <g key={k}><rect x="38" y={86 + k * 12} width="44" height="7" rx="3.5" fill="#E5E8EE" /><rect x="38" y={86 + k * 12} width={44 * Math.min(1, f)} height="7" rx="3.5" fill={c} /></g>)}
      <path d="M32,98 C20,108 18,124 20,138 L32,130Z M88,98 C100,108 102,124 100,138 L88,130Z" fill="#C9D0DB" />
      <path d={`M46,134 Q60,${150 + power * 44} 74,134Z`} fill="url(#rkf)" className="flame" />
    </svg>
  );
}
