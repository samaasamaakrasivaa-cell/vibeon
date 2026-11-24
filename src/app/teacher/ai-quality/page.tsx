import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getT } from "@/lib/i18n/server";
import { isOwner } from "@/lib/placement/bank";
import { modelLabel } from "@/lib/ai/models";
import type { CheckMeta, Stats } from "@/lib/ai/check-core";

export const metadata = { title: "Качество ИИ" };
export const dynamic = "force-dynamic";

type Row = { model: string; checks: number; approved: number; ai: number; kept: number; edited: number; removed: number; added: number; ms: number; fallback: number; dropped: number; cmp: number; cmpWon: number };

/** «Качество ИИ»: что учитель сделал с правками ИИ — по каждой модели. Владелец платформы может посмотреть по всем учителям. */
export default async function AiQuality({ searchParams }: { searchParams: Promise<{ all?: string }> }) {
  const { t, lang } = await getT();
  const me = await requireUser("TEACHER");
  const owner = isOwner(me.email);
  const all = owner && (await searchParams).all === "1";
  const list = await db.aiReview.findMany({
    where: all ? {} : { teacherId: me.id }, orderBy: { createdAt: "desc" }, take: 2000,
    select: { id: true, model: true, status: true, stats: true, meta: true, compareGroup: true, chosen: true, taskType: true, createdAt: true, approvedAt: true, student: { select: { name: true } } },
  });
  const by = new Map<string, Row>();
  const row = (m: string) => by.get(m) ?? by.set(m, { model: m, checks: 0, approved: 0, ai: 0, kept: 0, edited: 0, removed: 0, added: 0, ms: 0, fallback: 0, dropped: 0, cmp: 0, cmpWon: 0 }).get(m)!;
  const groups = new Map<string, typeof list>();
  for (const r of list) {
    const x = row(r.model), meta = (r.meta ?? {}) as Partial<CheckMeta>;
    x.checks++; x.ms += meta.ms ?? 0; x.dropped += meta.dropped ?? 0; if (meta.fallbackFrom) x.fallback++;
    if (r.status === "approved" && r.stats) {
      const s = r.stats as Stats;
      x.approved++; x.ai += s.ai; x.kept += s.kept; x.edited += s.edited; x.removed += s.removed; x.added += s.added;
    }
    if (r.compareGroup) groups.set(r.compareGroup, [...(groups.get(r.compareGroup) ?? []), r]);
  }
  // сравнение: в скольких парах учитель взял вариант этой модели (засчитываем пары, доведённые до «ОК»)
  for (const g of groups.values()) {
    if (!g.some((r) => r.status === "approved")) continue;
    for (const r of g) { const x = row(r.model); x.cmp++; if (r.status === "approved" && r.chosen) x.cmpWon++; }
  }
  const rows = [...by.values()].sort((a, b) => b.checks - a.checks);
  const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "—");
  const loc = lang === "ru" ? "ru-RU" : "en-GB";
  const recent = list.filter((r) => r.status === "approved").slice(0, 25);
  return (
    <div className="page" style={{ maxWidth: 1100 }}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
        <h1 className="m-0">{t("aq.title")}</h1>
        {owner && <div className="seg"><Link href="/teacher/ai-quality" aria-current={!all ? "page" : undefined}>{t("aq.mine")}</Link><Link href="/teacher/ai-quality?all=1" aria-current={all ? "page" : undefined}>{t("aq.all")}</Link></div>}
      </div>
      <p className="muted mt-0 mb-5">{t("aq.lead")}</p>
      {rows.length === 0 ? <section className="card"><p className="hint m-0">{t("aq.none")}</p></section> : (
        <section className="card overflow-x-auto">
          <table className="aqtable">
            <thead><tr>
              <th>{t("aq.model")}</th><th>{t("aq.checks")}</th><th>{t("aq.approved")}</th><th>{t("aq.aiEdits")}</th>
              <th title={t("aq.keptHint")}>{t("aq.kept")}</th><th>{t("aq.edited")}</th><th>{t("aq.removed")}</th><th>{t("aq.added")}</th>
              <th>{t("aq.cmp")}</th><th>{t("aq.time")}</th>
            </tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.model}>
                  <td><b>{modelLabel(r.model)}</b><div className="small muted">{r.model}</div></td>
                  <td>{r.checks}</td>
                  <td>{r.approved}</td>
                  <td>{r.ai}</td>
                  <td><b className="text-ok">{r.kept}</b> <span className="small muted">{pct(r.kept, r.ai)}</span></td>
                  <td>{r.edited} <span className="small muted">{pct(r.edited, r.ai)}</span></td>
                  <td><span className="text-bad">{r.removed}</span> <span className="small muted">{pct(r.removed, r.ai)}</span></td>
                  <td>{r.added}{r.approved ? <span className="small muted"> · {(r.added / r.approved).toFixed(1)} {t("aq.perCheck")}</span> : null}</td>
                  <td>{r.cmp ? `${r.cmpWon} / ${r.cmp}` : "—"}</td>
                  <td>{r.checks ? `${Math.round(r.ms / r.checks / 1000)} ${t("aq.sec")}` : "—"}{r.fallback ? <div className="small muted">{t("aq.fallback", { n: r.fallback })}</div> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="hint mb-0 mt-3">{t("aq.legend")}</p>
        </section>
      )}
      {recent.length > 0 && (
        <section className="card">
          <h2 className="mb-3">{t("aq.recent")}</h2>
          <div className="list">
            {recent.map((r) => { const s = r.stats as Stats; return (
              <div key={r.id} className="row">
                <div className="min-w-[90px] small">{(r.approvedAt ?? r.createdAt).toLocaleDateString(loc, { day: "numeric", month: "short" })}</div>
                <div className="grow"><div className="t">{r.student?.name ?? "—"} · {t(`aq.type.${r.taskType as "essay"}`)}</div><div className="s">{modelLabel(r.model)}{r.compareGroup ? ` · ${t("aq.fromCmp")}` : ""}</div></div>
                <span className="small"><span className="text-ok">✓ {s.kept}</span> · ✎ {s.edited} · <span className="text-bad">✕ {s.removed}</span> · + {s.added}</span>
              </div>
            ); })}
          </div>
        </section>
      )}
    </div>
  );
}
