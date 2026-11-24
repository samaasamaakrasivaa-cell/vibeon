import Link from "next/link";
import { Icon } from "@/components/Icon";
import { ProfileForm } from "@/components/student/ProfileForm";
import { AvatarPicker } from "@/components/awards/StudentAwards";
import { NotifySettings } from "@/components/NotifySettings";
import { LinkCabinet } from "@/components/admin/LinkCabinet";
import { settingsOf } from "@/lib/notify/settings";
import { tgEnabled } from "@/lib/notify/telegram";
import { requireUser } from "@/lib/auth/session";
import { isInternalEmail } from "@/lib/auth/cabinet";
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
      {s && <AvatarPicker id={s.id} avatar={s.avatar} tgLinked={!!me.telegramChatId} />}
      <ProfileForm hasPassword={!!me.passwordHash} init={{ name: me.name, lastName: me.lastName ?? "", phone: me.phone ?? "", telegram: s?.telegram ?? "", timezone: me.timezone, email: me.email }} />
      <NotifySettings role="STUDENT" init={settingsOf("STUDENT", me.notify)} linked={!!me.telegramChatId} enabled={tgEnabled()} email={me.email} />
      <LinkCabinet linked={await (async () => { const o = me.linkedUserId ? await db.user.findUnique({ where: { id: me.linkedUserId }, select: { role: true, email: true } }) : null; return o ? { ...o, shared: isInternalEmail(o.email) } : null; })()} />
      {s && (
        <section className="card">
          <h2 className="mb-2">{t("prf.teacher")}</h2>
          <p className="m-0">{[s.teacher.user.name, s.teacher.user.lastName].filter(Boolean).join(" ")}</p>
          <Link href="/student/messages" className="btn secondary sm mt-3"><Icon name="msg" size="sm" />{t("nav.chat")}</Link>
        </section>
      )}
    </div>
  );
}
