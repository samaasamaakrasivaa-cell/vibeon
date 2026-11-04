import { NotifySettings } from "@/components/NotifySettings";
import { ProfileForm } from "@/components/student/ProfileForm";
import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getT } from "@/lib/i18n/server";
import { settingsOf } from "@/lib/notify/settings";
import { tgEnabled } from "@/lib/notify/telegram";

export const metadata = { title: "Профиль" };

export default async function TeacherProfilePage() {
  const { t } = await getT();
  const me = await requireUser("TEACHER");
  const prof = await db.teacherProfile.findUnique({ where: { userId: me.id } });
  return (
    <div className="page" style={{ maxWidth: 820 }}>
      <h1 className="mb-5">{t("common.profile")}</h1>
      <ProfileForm teacher hasPassword={!!me.passwordHash} init={{ name: me.name, lastName: me.lastName ?? "", phone: me.phone ?? "", telegram: "", timezone: me.timezone, email: me.email, callLink: prof?.callLink ?? "" }} />
      <NotifySettings role="TEACHER" init={settingsOf("TEACHER", me.notify)} linked={!!me.telegramChatId} enabled={tgEnabled()} email={me.email} />
    </div>
  );
}
