import { NotifySettings } from "@/components/NotifySettings";
import { LinkCabinet } from "@/components/admin/LinkCabinet";
import { ProfileForm } from "@/components/student/ProfileForm";
import { requireUser } from "@/lib/auth/session";
import { isInternalEmail, loginOf } from "@/lib/auth/cabinet";
import { db } from "@/lib/db";
import { getT } from "@/lib/i18n/server";
import { settingsOf } from "@/lib/notify/settings";
import { tgEnabled } from "@/lib/notify/telegram";

export const metadata = { title: "Профиль" };

export default async function TeacherProfilePage() {
  const { t } = await getT();
  const me = await requireUser("TEACHER");
  const prof = await db.teacherProfile.findUnique({ where: { userId: me.id } });
  const login = await loginOf(me); // кабинет на входе ученика: почта и пароль — от входа
  const other = me.linkedUserId ? await db.user.findUnique({ where: { id: me.linkedUserId }, select: { role: true, email: true } }) : null;
  return (
    <div className="page" style={{ maxWidth: 820 }}>
      <h1 className="mb-5">{t("common.profile")}</h1>
      <ProfileForm teacher hasPassword={!!login.passwordHash} init={{ name: me.name, lastName: me.lastName ?? "", phone: me.phone ?? "", telegram: "", timezone: me.timezone, email: login.email, callLink: prof?.callLink ?? "" }} />
      <NotifySettings role="TEACHER" init={settingsOf("TEACHER", me.notify)} linked={!!me.telegramChatId} enabled={tgEnabled()} email={login.email} />
      <LinkCabinet linked={other ? { ...other, shared: isInternalEmail(me.email) || isInternalEmail(other.email) } : null} />
    </div>
  );
}
