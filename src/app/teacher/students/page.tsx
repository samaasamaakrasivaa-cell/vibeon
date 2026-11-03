import Link from "next/link";
import { StudentsGrid, type Card } from "@/components/teacher/StudentsGrid";
import { CopyLink } from "@/components/teacher/InviteForm";
import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { getT } from "@/lib/i18n/server";
import { initials } from "@/lib/invite";
import { rub } from "@/lib/teacher/data";

export const metadata = { title: "Ученики" };

const TABS = ["profiles", "roadmaps", "payments", "feedback"] as const;

export default async function Students({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
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
          <p className="hint mt-3 mb-0">{t("common.soon", { n: 7 })}</p>
        </section>
      )}

      {(tab === "roadmaps" || tab === "feedback") && (
        <section className="card">
          <p className="hint m-0">{t("common.soon", { n: tab === "roadmaps" ? 9 : 5 })}</p>
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
