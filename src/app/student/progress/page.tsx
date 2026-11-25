import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getT } from "@/lib/i18n/server";
import { Icon } from "@/components/Icon";
import { Medal } from "@/components/awards/Medal";
import { ProgressHead, type ProgressTab } from "@/components/student/SectionTabs";
import { ProgressStats } from "@/components/student/ProgressStats";
import { cleanInfo } from "@/lib/tasks/teacher-info";
import { dossier } from "@/lib/lessons/dossier";
import { Rich } from "@/components/roadmap/RouteBrief";

export const metadata = { title: "Мой прогресс" };
export const dynamic = "force-dynamic";

const TABS: ProgressTab[] = ["topics", "stats", "tests", "awards", "feedback"];

/** Цели урока из конструктора (лексика / грамматика) — по пунктам: строки, маркеры списка, точки с запятой. */
function points(text?: string) {
  if (!text) return [];
  return text
    .split(/\n|;|•/)
    .map((x) => x.replace(/^\s*(?:[-*–—]|\d+[.)])\s*/, "").trim().replace(/[.,]$/, ""))
    .filter((x) => x.length > 1)
    .slice(0, 12);
}

export default async function Progress({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { t, lang } = await getT();
  const me = await requireUser("STUDENT");
  const s = await db.student.findUnique({ where: { userId: me.id } });
  if (!s) return null;
  const sp = await searchParams;
  const tab: ProgressTab = (TABS as string[]).includes(sp.tab ?? "") ? (sp.tab as ProgressTab) : "topics";
  const tz = me.timezone;
  const loc = lang === "ru" ? "ru-RU" : "en-GB";
  const fmt = (d: Date, long = false) => d.toLocaleDateString(loc, { day: "numeric", month: long ? "long" : "short", timeZone: tz });

  return (
    <div className="page" style={{ maxWidth: 980 }}>
      <ProgressHead active={tab} />
      {tab === "topics" && <Topics />}
      {tab === "stats" && <ProgressStats studentId={s.id} tz={tz} lang={lang} t={t} topics={await db.lessonInstance.count({ where: { studentId: s.id, status: "DONE", templateId: { not: null } } })} />}
      {tab === "tests" && <Tests />}
      {tab === "awards" && <Awards />}
      {tab === "feedback" && <Feedback />}
    </div>
  );

  // ── Изученные темы: из пройденных уроков — грамматика и лексика (цели урока в конструкторе), сами уроки
  async function Topics() {
    const done = await db.lessonInstance.findMany({
      where: { studentId: s!.id, status: "DONE", templateId: { not: null } },
      select: { id: true, startsAt: true, template: { select: { id: true, title: true, subtitle: true, teacherInfo: true, unit: { select: { title: true, course: { select: { title: true } } } } } } },
      orderBy: { startsAt: "desc" },
    });
    // один шаблон урока мог идти несколько занятий — берём последнее
    const lessons = [...new Map(done.map((l) => [l.template!.id, l])).values()];
    type Pt = { text: string; lessons: { id: string; title: string; at: Date }[] };
    const collect = (key: "grammar" | "vocabulary") => {
      const m = new Map<string, Pt>();
      for (const l of lessons) {
        // ученику — только цели «лексика» и «грамматика»; заметки и ход урока остаются у учителя
        const aims = cleanInfo(l.template!.teacherInfo).aims;
        for (const p of points(aims?.[key])) {
          const k = p.toLowerCase();
          const cur = m.get(k) ?? { text: p, lessons: [] };
          cur.lessons.push({ id: l.id, title: l.template!.title, at: l.startsAt });
          m.set(k, cur);
        }
      }
      return [...m.values()];
    };
    const grammar = collect("grammar"), vocab = collect("vocabulary");
    // досье по темам — только из итогов, которые утвердил преподаватель
    const rm = await db.roadmap.findFirst({ where: { studentId: s!.id }, orderBy: { createdAt: "desc" }, select: { meta: true } });
    const ds = await dossier(s!.id, { approvedOnly: true, threshold: ((rm?.meta ?? {}) as { threshold?: number }).threshold });
    const stCls = { own: "green", watch: "orange", gap: "red" } as const;
    if (lessons.length === 0) return <section className="card rtempty"><Icon name="book" /><div><b>{t("pg.noTopics")}</b><div className="small muted">{t("pg.topicsHint")}</div></div></section>;
    const block = (title: string, color: string, list: Pt[]) => (
      <div className="blk2 topicblk">
        <div className="blkh"><i style={{ background: color }} /><b>{title}</b><span className="small muted">{list.length}</span></div>
        {list.length === 0 ? <p className="small muted m-0 mt-2">{t("pg.noAims")}</p> : list.map((p) => (
          <div key={p.text} className="can">
            <Icon name="check" size="sm" />
            <span className="grow">{p.text}<span className="block small muted">{p.lessons.map((x) => `${x.title} · ${fmt(x.at)}`).join(", ")}</span></span>
          </div>
        ))}
      </div>
    );
    return (
      <div className="flex flex-col gap-5">
        {ds.topics.length > 0 && (
          <section className="card flex flex-col gap-3 dossier">
            <div><h2 className="m-0">{t("ds.myTitle")}</h2><div className="small muted">{t("ds.mySub")}</div></div>
            <div className="dtopics">
              {ds.topics.map((x) => (
                <div key={x.key} className={`dtopic ${x.status}`}>
                  <div className="flex items-center gap-2"><b className="grow">{x.name}</b><span className={`pill ${stCls[x.status]}`}>{t(`ds.st.${x.status}`)}</span></div>
                  <div className="dbar"><span style={{ width: `${x.score}%` }} /><i style={{ left: `${ds.threshold}%` }} /></div>
                  <div className="small muted">{x.score}%{x.trend !== null && x.trend !== 0 ? ` · ${x.trend > 0 ? "▲" : "▼"}${Math.abs(x.trend)}` : ""} · {t("ds.lessons", { n: x.lessons })}</div>
                </div>
              ))}
            </div>
            {ds.summaries.slice(0, 5).map((x) => (
              <details key={x.id} className="dsum">
                <summary><span className="grow"><b>{x.title || t("ds.lesson")}</b> <span className="small muted">· {fmt(new Date(x.date))}</span></span><Icon name="chevd" size="sm" /></summary>
                <div className="dsum-body">
                  {x.notes?.points?.length > 0 && <ul className="rbul">{x.notes.points.map((p, i) => <li key={i}><Rich text={p} /></li>)}</ul>}
                  {(x.notes?.words?.length ?? 0) > 0 && <div className="small mt-2"><b>{t("ds.words")}:</b> {x.notes.words.join(", ")}</div>}
                </div>
              </details>
            ))}
          </section>
        )}
        <div className="blocks topicgrid">
          {block(t("rm.grammar"), "#007AFF", grammar)}
          {block(t("rm.vocab"), "#FF9500", vocab)}
        </div>
        <section className="card">
          <h2 className="mb-3">{t("pg.lessonsDone", { n: lessons.length })}</h2>
          <div className="list">
            {lessons.map((l) => (
              <Link key={l.id} href={`/class/${l.id}?tab=homework`} className="row hover:bg-surface2">
                <div className="min-w-[70px]"><b className="block">{fmt(l.startsAt)}</b></div>
                <div className="grow"><div className="t">{l.template!.title}{l.template!.subtitle ? ` · ${l.template!.subtitle}` : ""}</div><div className="s">{l.template!.unit.course.title} · {l.template!.unit.title}</div></div>
                <Icon name="right" size="sm" />
              </Link>
            ))}
          </div>
        </section>
      </div>
    );
  }

  // ── Тесты: placement test и контрольные срезы маршрута; результаты — когда преподаватель их откроет
  async function Tests() {
    const [attempts, cps] = await Promise.all([
      db.placementAttempt.findMany({ where: { studentId: s!.id, mode: "student", checkpointId: { not: null } }, orderBy: { createdAt: "desc" }, take: 30 }),
      db.checkpoint.findMany({ where: { studentId: s!.id, kind: { in: ["slice", "final"] } }, orderBy: { assignedAt: "desc" }, take: 30 }),
    ]);
    return (
      <div className="flex flex-col gap-5">
        <section className="card hintcard">
          <Icon name="info" />
          <div><b>{t("pg.testsHowT")}</b><p className="small muted m-0 mt-1">{t("pg.testsHow")}</p></div>
        </section>
        <section className="list">
          {attempts.length + cps.length === 0 && <p className="hint p-5 m-0">{t("pg.noTests")}</p>}
          {attempts.map((x) => {
            const open = x.status === "reviewed" && x.showResult;
            const state = x.status === "reviewed" ? (open ? t("stl.testOpen") : t("pg.testChecked")) : x.status === "submitted" ? t("stl.testSent") : x.status === "active" ? t("stl.testGoOn") : t("stl.testStart");
            const body = (
              <>
                <span className="pill violet"><Icon name="target" size="sm" /></span>
                <div className="grow"><div className="t">{x.track === "teen" ? "Placement test Teens" : "Placement test"}</div><div className="s">{fmt(x.reviewedAt ?? x.createdAt, true)} · {state}</div></div>
                {open ? <span className="pill green">{x.level ?? "✓"}</span> : x.status === "reviewed" ? <span className="pill grey">✓</span> : <span className={`pill ${x.status === "submitted" ? "orange" : "red"}`}>{x.status === "submitted" ? t("stl.hwSent") : t("stl.hwTodo")}</span>}
              </>
            );
            // пройденный, но не открытый учителем результат — без ссылки
            return x.status === "reviewed" && !open
              ? <div key={x.id} className="row">{body}</div>
              : <Link key={x.id} href={`/student/test/${x.checkpointId}`} className="row hover:bg-surface2">{body}</Link>;
          })}
          {cps.map((c) => {
            const score = (c.results as { score?: number } | null)?.score;
            return (
              <Link key={c.id} href={c.status === "assigned" ? `/student/test/${c.id}` : "/student/route?tab=now"} className="row hover:bg-surface2">
                <span className="pill blue"><Icon name="route" size="sm" /></span>
                <div className="grow"><div className="t">{c.kind === "final" ? t("pg.finalTest") : t("pg.sliceTest", { n: (c.stage ?? 0) + 1 })}</div><div className="s">{fmt(c.takenAt ?? c.assignedAt, true)}</div></div>
                {c.status === "done" ? <span className="pill green">{[c.level, score !== undefined ? `${score}%` : null].filter(Boolean).join(" · ") || "✓"}</span> : <span className="pill red">{t("stl.hwTodo")}</span>}
              </Link>
            );
          })}
        </section>
      </div>
    );
  }

  async function Awards() {
    const awards = await db.award.findMany({ where: { studentId: s!.id }, orderBy: { createdAt: "desc" } });
    const now = new Date();
    return (
      <section className="card" id="awards">
        <h2 className="mb-1">{t("aw.mine")}</h2>
        <p className="small muted mt-0 mb-4">{t("aw.mineHint")}</p>
        {awards.length === 0 ? <p className="hint m-0">{t("aw.mineNone")}</p> : (
          <div className="awshelf">
            {awards.map((a) => {
              const off = a.kind === "title" && !!a.until && a.until < now;
              return (
                <div key={a.id} className={`awitem ${a.kind === "title" && a.pinned && !off ? "pinned" : ""}`}>
                  <Medal icon={a.icon} color={a.color} size={72} shape={a.kind === "title" ? "hex" : "circle"} muted={off} />
                  <b>{a.name}</b>
                  <span className="small muted">{a.kind === "cheer" ? fmt(a.createdAt, true) : off ? t("aw.wasUntil", { d: fmt(a.until!, true) }) : a.until ? t("aw.until", { d: fmt(a.until, true) }) : t("aw.forever")}</span>
                  {a.why && <span className="awitem-why">{a.why}</span>}
                </div>
              );
            })}
          </div>
        )}
      </section>
    );
  }

  // ── Фидбэк — как у учителя во вкладке анкеты, только без формы
  async function Feedback() {
    const list = await db.feedback.findMany({ where: { studentId: s!.id }, orderBy: { createdAt: "desc" }, include: { lessonInstance: { include: { template: { select: { title: true } } } } } });
    return (
      <section className="list">
        {list.length === 0 && <p className="hint p-5 m-0">{t("pg.noFeedback")}</p>}
        {list.map((f) => (
          <div key={f.id} className="qrow"><div className="grow">
            <div className="flex flex-wrap justify-between gap-2"><span className="small muted">{f.lessonInstance?.template?.title ?? f.period ?? ""}</span><span className="small text-text3">{fmt(f.createdAt, true)}</span></div>
            <p className="mb-0 mt-1 whitespace-pre-line">{f.text}</p>
          </div></div>
        ))}
      </section>
    );
  }
}
