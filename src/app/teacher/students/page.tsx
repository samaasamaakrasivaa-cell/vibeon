import { InviteForm, CopyLink } from "@/components/teacher/InviteForm";
import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { getT } from "@/lib/i18n/server";
import { initials } from "@/lib/invite";

export const metadata = { title: "Ученики" };

export default async function Students() {
  const { t, lang } = await getT();
  const me = await requireUser("TEACHER");
  const students = await db.student.findMany({
    where: { teacherId: me.id, status: { in: ["ACTIVE", "INVITED"] } },
    include: { invites: { orderBy: { createdAt: "desc" }, take: 1 } },
    orderBy: { createdAt: "desc" },
  });
  const active = students.filter((s) => s.status === "ACTIVE");
  const invited = students.filter((s) => s.status === "INVITED");
  const loc = lang === "ru" ? "ru-RU" : "en-GB";
  return (
    <div className="page">
      <h1 className="mb-6">{t("nav.students")}</h1>
      <section className="card">
        <h2 className="mb-4">{t("inviteT.title")}</h2>
        <InviteForm />
      </section>

      {invited.length > 0 && (
        <section className="card">
          <h2 className="mb-3">{t("inviteT.invited")}</h2>
          <div className="list" style={{ background: "var(--surface2)" }}>
            {invited.map((s) => {
              const inv = s.invites[0];
              const expired = !inv || inv.expiresAt < new Date();
              return (
                <div key={s.id} className="row wrap-phone">
                  <span className="avatar lg" style={{ background: "var(--grey-bg)", color: "var(--grey-text)" }}>{initials(s.name, s.lastName)}</span>
                  <div className="grow">
                    <div className="t">{s.name}</div>
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

      <section className="card">
        <h2 className="mb-3">{t("inviteT.active")}</h2>
        {active.length === 0 ? (
          <p className="hint m-0">{t("inviteT.none")}</p>
        ) : (
          <div className="list" style={{ background: "var(--surface2)" }}>
            {active.map((s) => (
              <div key={s.id} className="row">
                <span className="avatar lg">{initials(s.name, s.lastName)}</span>
                <div className="grow">
                  <div className="t">{[s.name, s.lastName].filter(Boolean).join(" ")}</div>
                  <div className="s">{s.email}</div>
                </div>
                <span className="pill green">{lang === "ru" ? "Занимается" : "Active"}</span>
              </div>
            ))}
          </div>
        )}
        <p className="hint mt-3 mb-0">{t("inviteT.more")}</p>
      </section>
    </div>
  );
}
