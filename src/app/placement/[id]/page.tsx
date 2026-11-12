import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Brand, LogoMark } from "@/components/Logo";
import { PlacementRunner } from "@/components/placement/PlacementRunner";
import { getT } from "@/lib/i18n/server";
import { attemptFor } from "@/lib/placement/access";
import { audioUrl, getBank } from "@/lib/placement/bank";
import { STEPS, summarize } from "@/lib/placement/engine";
import { publicView, stateOf } from "@/lib/placement/run";

export const metadata = { title: "Placement test", robots: { index: false } };

/** Прохождение вводного теста — отдельный экран без меню, чтобы ничего не отвлекало. */
export default async function PlacementPage({ params }: { params: Promise<{ id: string }> }) {
  const { t, lang } = await getT();
  const { id } = await params;
  const acc = await attemptFor(id);
  if (!acc) notFound();
  const { a, who } = acc;
  if (who === "teacher") redirect(`/teacher/placement/${id}`);
  const st = stateOf(a.state);
  const home = a.mode === "student" ? "/student" : a.mode === "self" ? "/teacher/courses?tab=tests" : null;

  let done: React.ReactNode = null;
  if (st.section === "done" || a.status === "submitted" || a.status === "reviewed") {
    const pre = a.mode === "link" && a.link?.showResult ? summarize(st, (await getBank()).bank) : null;
    const pct = (r?: [number, number]) => (r && r[1] ? Math.round((r[0] / r[1]) * 100) : null);
    done = (
      <section className="card flex flex-col items-center gap-3 text-center">
        <span className="plck ok big"><Icon /></span>
        <h2 className="m-0">{t("pl.doneTitle")}</h2>
        {a.mode === "self" ? <><p className="muted m-0">{t("pl.doneSelf")}</p><Link className="btn primary" href={`/teacher/placement/${id}`}>{t("pl.openReview")}</Link></>
          : a.mode === "student" ? <><p className="muted m-0">{t("pl.doneStudent")}</p><Link className="btn primary" href="/student">{t("pl.toCabinet")}</Link></>
          : pre ? (
            <>
              <p className="muted m-0">{t("pl.donePre")}</p>
              <div className="lvlbig">{STEPS[pre.coreStep]}</div>
              <div className="small muted">{t("pl.preNote")}</div>
              <div className="plpre">
                {pct(pre.reading[pre.level]) !== null && <span>{t("pl.part.reading")}: <b>{pct(pre.reading[pre.level])}%</b></span>}
                {pct(pre.listening[pre.level]) !== null && <span>{t("pl.part.listening")}: <b>{pct(pre.listening[pre.level])}%</b></span>}
              </div>
            </>
          ) : <p className="muted m-0">{t("pl.doneGuest")}</p>}
      </section>
    );
  }
  return (
    <>
      <header className="apptop flexbar">
        <span className="atl"><LogoMark /><Brand /></span>
        {home && <Link href={home} className="small muted">{t("pl.exit")}</Link>}
      </header>
      <main className="main">
        <div className="page" style={{ maxWidth: 820 }}>
          <h1 className="mb-4">{t("pl.title")}</h1>
          <PlacementRunner id={id} canFlag={a.mode === "self"} initial={done ? { section: "done", level: null, open: [], locked: [] } : publicView(st, lang, (await getBank()).bank)} sample={audioUrl("S-A1-01-q1")} done={done} home={home} />
        </div>
      </main>
    </>
  );
}

function Icon() {
  return <svg className="i" viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 5 5 9-10" /></svg>;
}
