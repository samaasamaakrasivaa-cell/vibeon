import { TeacherAboutForm } from "@/components/teacher/TeacherAbout";
import { cleanAbout } from "@/lib/teacher/about-data";
import { NotifySettings } from "@/components/NotifySettings";
import { LinkCabinet } from "@/components/admin/LinkCabinet";
import { ProfileForm } from "@/components/student/ProfileForm";
import { requireUser } from "@/lib/auth/session";
import { isDemoEmail, isInternalEmail, loginOf } from "@/lib/auth/cabinet";
import { DemoStudent } from "@/components/teacher/DemoStudent";
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
      {/* анкета преподавателя — её видят ученики (страница «Мой преподаватель») */}
      <TeacherAboutForm name={[me.name, me.lastName].filter(Boolean).join(" ")} init={cleanAbout(prof?.about)} />
      <NotifySettings role="TEACHER" init={settingsOf("TEACHER", me.notify)} linked={!!me.telegramChatId} enabled={tgEnabled()} email={login.email} />
      {/* тестовый ученик — свой кабинет ученика на этом же входе; другой привязанный кабинет — как раньше */}
      <DemoStudent demo={other && isDemoEmail(other.email) ? { studentId: (await db.student.findFirst({ where: { user: { email: other.email } }, select: { id: true } }))?.id ?? "" } : null} blocked={!!other && !isDemoEmail(other.email)} />
      {!(other && isDemoEmail(other.email)) && <LinkCabinet linked={other ? { ...other, shared: isInternalEmail(me.email) || isInternalEmail(other.email) } : null} />}
    </div>
  );
}
