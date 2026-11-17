import Link from "next/link";
import { Icon } from "@/components/Icon";
import { getT } from "@/lib/i18n/server";
import { requireAdmin } from "@/lib/admin/access";
import { adminFeed, mrrOf, teacherRows } from "@/lib/admin/data";
import { rub } from "@/lib/admin/features";
import { db } from "@/lib/db";

/** Обзор: главные цифры платформы и лента событий, требующих внимания. */
export default async function AdminHome() {
  const { t, lang } = await getT();
  await requireAdmin();
  const now = new Date();
  const rows = await teacherRows(now);
  const [mrr, feed, rev30, students, lessons30] = await Promise.all([
    mrrOf(rows), adminFeed(rows, now),
    db.teacherPayment.aggregate({ where: { paidAt: { gte: new Date(now.getTime() - 30 * 864e5) } }, _sum: { amount: true } }),
    db.student.count({ where: { status: "ACTIVE" } }),
    db.lessonInstance.count({ where: { status: "DONE", startsAt: { gte: new Date(now.getTime() - 30 * 864e5) } } }),
  ]);
  const n = (s: string) => rows.filter((r) => r.state === s).length;
  const everPaid = rows.filter((r) => r.paidTotal > 0).length;
  const activated = rows.filter((r) => r.activated).length;
  const active7 = rows.filter((r) => r.lastSeenAt && r.lastSeenAt > new Date(now.getTime() - 7 * 864e5)).length;
  const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);
  const loc = lang === "en" ? "en-GB" : "ru-RU";
  const when = (d: Date) => d.toLocaleDateString(loc, { day: "numeric", month: "short" });
  const tiles = [
    { icon: "users", c: "var(--accent)", v: rows.length, l: t("adm.k.teachers"), s: t("adm.k.teachersSub", { a: active7 }) },
    { icon: "hourglass", c: "var(--warn)", v: n("trial"), l: t("adm.k.trial") },
    { icon: "check", c: "var(--ok)", v: n("paid"), l: t("adm.k.paid") },
    { icon: "coin", c: "var(--violet)", v: rub(mrr), l: t("adm.k.mrr"), s: t("adm.k.mrrSub") },
    { icon: "wallet", c: "#5AC8FA", v: rub(rev30._sum.amount ?? 0), l: t("adm.k.rev30") },
    { icon: "chart", c: "#FF9500", v: `${pct(everPaid, rows.length)}%`, l: t("adm.k.conv"), s: t("adm.k.convSub", { a: everPaid, b: rows.length }) },
    { icon: "spark", c: "#34C759", v: `${pct(activated, rows.length)}%`, l: t("adm.k.activation"), s: t("adm.k.activationSub") },
    { icon: "class", c: "var(--accent)", v: lessons30, l: t("adm.k.lessons30") },
    { icon: "user", c: "#AF52DE", v: students, l: t("adm.k.students") },
  ] as const;
  return (
    <div className="page">
      <h1 className="mb-5">{t("adm.nav.overview")}</h1>
      <section className="card">
        <div className="grid-3">
          {tiles.map((x) => (
            <div key={x.l} className="fintile"><span className="si" style={{ background: x.c }}><Icon name={x.icon} /></span><div><b>{x.v}</b><span>{x.l}</span>{"s" in x && x.s && <span className="block small muted">{x.s}</span>}</div></div>
          ))}
        </div>
      </section>
      <section className="card">
        <div className="mb-3 flex items-center gap-2"><h2 className="m-0 grow">{t("adm.feed")}</h2><Link href="/admin/teachers" className="alink small">{t("adm.nav.teachers")} →</Link></div>
        {feed.length === 0 ? <p className="hint m-0">{t("adm.feedNone")}</p> : (
          <ul className="admfeed">
            {feed.map((f, i) => (
              <li key={i} className={`admfeed-${f.kind}`}>
                <span className="admfeed-dot" aria-hidden="true" />
                <Link href={`/admin/teachers/${f.teacherId}`} className="grow min-w-0">
                  <b>{f.name}</b> — {t(`adm.ev.${f.kind}` as "adm.ev.signup", { n: f.days ?? 0, sum: rub(f.amount ?? 0) })}
                </Link>
                <span className="small muted nowrap">{when(f.at)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
