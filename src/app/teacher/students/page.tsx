import Link from "next/link";
import { StudentsGrid, type Card } from "@/components/teacher/StudentsGrid";
import { CopyLink } from "@/components/teacher/InviteForm";
import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { getT } from "@/lib/i18n/server";
import { initials } from "@/lib/invite";
import { rub } from "@/lib/teacher/data";
import { roadmapView } from "@/lib/roadmap/progress";

export const metadata = { title: "Ученики" };

const TABS = ["profiles", "roadmaps", "payments", "feedback"] as const;

export default async function Students({ searchParams }: { searchParams: Promise<{ tab?: string; invite?: string }> }) {
  const { t, lang } = await getT();
  const me = await requireUser("TEACHER");
  const sp = await searchParams;
  const tab = sp.tab === "archive" ? "archive" : (TABS as readonly string[]).includes(sp.tab ?? "") ? sp.tab! : "profiles";

  const all = await db.student.findMany({
    where: { teacherId: me.id },
    include: { invites: { orderBy: { createdAt: "desc" }, take: 1 }, packs: { orderBy: { startsAt: "desc" }, take: 1 } },
    orderBy: [{ name: "asc" }],
  });
  const active = all.filter((s) => s.status === "ACTIVE");
  const invited = all.filter((s) => s.status === "INVITED");
  const archived = all.filter((s) => s.status === "ARCHIVED");
  const full = (s: { name: string; lastName: string | null }) => [s.name, s.lastName].filter(Boolean).join(" ");
  const card = (s: (typeof all)[number], i: number, sub: string, badge?: string): Card => ({
    id: s.id, name: full(s), initials: initials(s.name, s.lastName), color: i, sub, href: `/teacher/students/${s.id}`, badge,
  });
  const loc = lang === "ru" ? "ru-RU" : "en-GB";

  const tabLabel: Record<string, string> = {
    profiles: t("stu.tab.profiles"), roadmaps: t("stu.tab.roadmaps"), payments: t("stu.tab.payments"), feedback: t("stu.tab.feedback"),
  };

  return (
    <div className="page">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h1>{t("nav.students")}</h1>
        <Link href={tab === "archive" ? "/teacher/students" : "/teacher/students?tab=archive"} className="btn secondary sm">
          {tab === "archive" ? t("stu.backToActive") : `${t("stu.archive")} (${archived.length})`}
        </Link>
      </div>

      {tab !== "archive" && (
        <nav className="tabsbar mb-5">
          {TABS.map((k) => (
            <Link key={k} href={`/teacher/students?tab=${k}`} aria-current={tab === k ? "page" : undefined}>{tabLabel[k]}</Link>
          ))}
        </nav>
      )}

      {tab === "profiles" && (
        <>
          <StudentsGrid
            openInvite={sp.invite === "1"}
            invite
            cards={active.map((s, i) => card(s, i, s.course ?? s.level ?? s.email ?? ""))}
            empty={t("inviteT.none")}
          />
          {invited.length > 0 && (
            <section className="card">
              <h2 className="mb-3">{t("inviteT.invited")}</h2>
              <div className="list" style={{ background: "var(--surface2)" }}>
                {invited.map((s) => {
                  const inv = s.invites[0];
                  const expired = !inv || !!inv.usedAt || inv.expiresAt < new Date();
                  return (
                    <div key={s.id} className="row wrap-phone">
                      <span className="avatar lg" style={{ background: "var(--grey-bg)", color: "var(--grey-text)" }}>{initials(s.name, s.lastName)}</span>
                      <div className="grow">
                        <Link href={`/teacher/students/${s.id}`} className="t hover:text-accent">{s.name}</Link>
                        <div className="s">
                          {s.email ?? s.telegram} · {expired ? t("inviteT.expired") : t("inviteT.expires", { d: inv.expiresAt.toLocaleDateString(loc, { day: "numeric", month: "long" }) })}
                        </div>
                      </div>
                      {inv && !expired && <CopyLink link={`${env.appUrl}/invite/${inv.token}`} />}
                    </div>
                  );
                })}
              </div>
            </section>
          )}
        </>
      )}

      {tab === "payments" && (
        <section className="card">
          {active.length === 0 ? <p className="hint m-0">{t("inviteT.none")}</p> : (
            <div className="list" style={{ background: "var(--surface2)" }}>
              {active.map((s) => (
                <Link key={s.id} href={`/teacher/students/${s.id}`} className="row wrap-phone hover:bg-fill">
                  <span className="avatar">{initials(s.name, s.lastName)}</span>
                  <div className="grow"><div className="t">{full(s)}</div><div className="s">{s.payType === "PACK" ? t("prof.pack") : t("prof.postpaid")}{s.price ? ` · ${rub(s.price, lang)} ${t("prof.perLesson")}` : ""}</div></div>
                  {s.payType === "PACK" && s.packs[0] && <span className="pill blue">{t("prof.left", { n: s.packs[0].lessonsLeft, total: s.packs[0].lessonsTotal })}</span>}
                </Link>
              ))}
            </div>
          )}
        </section>
      )}

      {tab === "roadmaps" && (
        <div className="rmcards">
          {active.length === 0 && <section className="card"><p className="hint m-0">{t("inviteT.none")}</p></section>}
          {await Promise.all(active.map(async (s, i) => {
            const v = await roadmapView(s.id, me.timezone);
            const r = v.r;
            return (
              <Link key={s.id} href={`/teacher/students/${s.id}?tab=roadmap`} className="card rmcard">
                <div className="flex items-center gap-3"><span className={`avatar lg c${i % 6}`}>{initials(s.name, s.lastName)}</span><div className="min-w-0 grow"><b className="block truncate">{full(s)}</b><span className="small muted">{r?.builtAt ? `${r.fromLevel ?? "?"} → ${r.goal}` : t("rm.noRoadmap")}</span></div></div>
                {r?.builtAt && "achievements" in v ? (
                  <>
                    <div className="mt-3 flex items-center gap-2"><span className="stbar grow"><span style={{ width: `${v.achievements.pct}%` }} /></span><b>{v.achievements.pct}%</b></div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {!r.approvedAt ? <span className="pill orange">{t("rm.draft")}</span> : v.lateWeeks > 0 ? <span className="pill red">{t("rm.late", { n: v.lateWeeks })}</span> : v.lateWeeks < 0 ? <span className="pill green">{t("rm.ahead", { n: -v.lateWeeks })}</span> : <span className="pill green">{t("rm.onTrack")}</span>}
                      {v.checkpoints.some((c) => c.status === "assigned") && <span className="pill grey">{t("rm.testOpen")}</span>}
                    </div>
                  </>
                ) : <div className="mt-3 flex flex-wrap gap-1.5"><span className="pill grey">{t("rm.build")}</span>{v.checkpoints.some((c) => c.status === "assigned") && <span className="pill orange">{t("rm.testOpen")}</span>}</div>}
              </Link>
            );
          }))}
        </div>
      )}
      {tab === "feedback" && (
        <section className="list">
          {(await db.feedback.findMany({ where: { student: { teacherId: me.id } }, include: { student: true }, orderBy: { createdAt: "desc" }, take: 100 })).map((f) => (
            <Link key={f.id} href={`/teacher/students/${f.studentId}?tab=feedback`} className="qrow hover:bg-fill">
              <span className="avatar lg">{initials(f.student.name, f.student.lastName)}</span>
              <div className="grow"><div className="flex flex-wrap justify-between gap-2"><b>{full(f.student)}</b><span className="small text-text3">{f.createdAt.toLocaleDateString(loc, { day: "numeric", month: "short", timeZone: me.timezone })}</span></div><p className="mb-0 mt-1 line-clamp-2">{f.text}</p></div>
            </Link>
          ))}
          {(await db.feedback.count({ where: { student: { teacherId: me.id } } })) === 0 && <p className="hint p-5 m-0">{t("pr.noFb")}</p>}
        </section>
      )}

      {tab === "archive" && (
        <>
          <p className="hint mt-0 mb-4">{t("stu.archiveHint")}</p>
          <StudentsGrid cards={archived.map((s, i) => card(s, i, s.course ?? s.email ?? "", t("stu.archived")))} empty={t("stu.archiveEmpty")} />
        </>
      )}
    </div>
  );
}
