import Link from "next/link";
import { getT } from "@/lib/i18n/server";
import { notFound } from "next/navigation";
import { TeacherCard } from "@/components/teacher/TeacherAbout";
import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { aboutFilled, cleanAbout } from "@/lib/teacher/about-data";

export const metadata = { title: "Мой преподаватель" };
export const dynamic = "force-dynamic";

/** Ученик: анкета своего преподавателя — образование, опыт, сертификаты, подход. */
export default async function MyTeacherPage() {
  const me = await requireUser("STUDENT");
  const { t } = await getT();
  const s = await db.student.findUnique({ where: { userId: me.id }, select: { teacher: { select: { about: true, user: { select: { name: true, lastName: true } } } } } });
  if (!s) notFound();
  const a = cleanAbout(s.teacher.about);
  if (a.show === false || !aboutFilled(a)) notFound();
  return (
    <div className="page" style={{ maxWidth: 820 }}>
      <Link href="/student/messages" className="alink mb-4 inline-block">← {t("nav.chat")}</Link>
      <TeacherCard name={[s.teacher.user.name, s.teacher.user.lastName].filter(Boolean).join(" ")} a={a} />
    </div>
  );
}
