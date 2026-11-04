import Link from "next/link";
import { Icon } from "@/components/Icon";
import { ProfileForm } from "@/components/student/ProfileForm";
import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getT } from "@/lib/i18n/server";

export const metadata = { title: "Профиль" };

export default async function StudentProfile() {
  const { t } = await getT();
  const me = await requireUser("STUDENT");
  const s = await db.student.findUnique({ where: { userId: me.id }, include: { teacher: { include: { user: true } } } });
  return (
    <div className="page" style={{ maxWidth: 820 }}>
      <h1 className="mb-5">{t("common.profile")}</h1>
      <ProfileForm hasPassword={!!me.passwordHash} init={{ name: me.name, lastName: me.lastName ?? "", phone: me.phone ?? "", telegram: s?.telegram ?? "", timezone: me.timezone, email: me.email }} />
      <section className="card">
        <h2 className="mb-2">Telegram</h2>
        <p className="muted mt-0">{t("tg.lead")}</p>
        <button className="btn primary" disabled title={t("tg.soon")}><Icon name="telegram" size="sm" />{t("tg.connect")}</button>
        <p className="hint mb-0">{t("tg.soon")}</p>
      </section>
      {s && (
        <section className="card">
          <h2 className="mb-2">{t("prf.teacher")}</h2>
          <p className="m-0">{[s.teacher.user.name, s.teacher.user.lastName].filter(Boolean).join(" ")}</p>
          <Link href="/student/messages" className="btn secondary sm mt-3"><Icon name="msg" size="sm" />{t("nav.messages")}</Link>
        </section>
      )}
    </div>
  );
}
