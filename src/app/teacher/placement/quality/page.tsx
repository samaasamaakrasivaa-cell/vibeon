import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { getT } from "@/lib/i18n/server";
import { isOwner } from "@/lib/placement/bank";
import { qualityData } from "@/lib/placement/quality";
import { Icon } from "@/components/Icon";

export const metadata = { title: "Placement test — качество вопросов" };
export const dynamic = "force-dynamic";

/** Владелец платформы: какие задания грамматики ведут себя не по своему уровню (по итогам, которые поставили учителя). */
export default async function QualityPage() {
  const { t } = await getT();
  const me = await requireUser("TEACHER");
  if (!isOwner(me.email)) notFound();
  const d = await qualityData();
  const flagged = d.rows.filter((r) => r.flag);
  const pct = (r: [number, number]) => (r[1] ? `${Math.round((r[0] / r[1]) * 100)}% (${r[0]}/${r[1]})` : "—");
  const FL: Record<string, [string, string]> = { easy: ["orange", t("q.easy")], hard: ["red", t("q.hard")], trap: ["violet", t("q.trap")] };
  return (
    <div className="page" style={{ maxWidth: 1000 }}>
      <Link href="/teacher/placement/bank" className="small muted">← {t("pl.bankTitle")}</Link>
      <div className="mt-2 mb-1 flex flex-wrap items-center gap-3">
        <h1 className="m-0 grow">{t("q.title")}</h1>
        <a className="btn secondary sm" href="/api/placement/quality-export"><Icon name="dl" size="sm" />{t("q.export")}</a>
      </div>
      <p className="muted mt-0 mb-4">{t("q.lead", { a: d.attempts, n: d.enough, all: d.items })}</p>
      <section className="card flex flex-col gap-3">
        <h3 className="m-0">{t("q.flagged", { n: flagged.length })}</h3>
        <p className="small muted m-0">{t("q.how")}</p>
        {flagged.length === 0 ? <p className="hint m-0">{d.attempts < 20 ? t("q.fewData") : t("q.none")}</p> : (
          <div className="tblwrap">
            <table className="prtbl">
              <thead><tr><th>{t("q.item")}</th><th>{t("q.flag")}</th><th>{t("q.below")}</th><th>{t("q.atOrAbove")}</th><th>{t("q.topWrong")}</th></tr></thead>
              <tbody>
                {flagged.map((r) => (
                  <tr key={r.id}>
                    <th><span className="pill grey">{r.level}</span> <span className="small muted">{r.id} · {r.topic}</span><div className="small" style={{ fontWeight: 400 }}>{r.q}</div></th>
                    <td><span className={`pill ${FL[r.flag!][0]}`}>{FL[r.flag!][1]}</span></td>
                    <td>{pct(r.below)}</td>
                    <td>{pct(r.atOrAbove)}</td>
                    <td>{r.topWrong ? `«${r.topWrong.v}» — ${r.topWrong.n} ${t("q.of")} ${r.wrongN}` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
