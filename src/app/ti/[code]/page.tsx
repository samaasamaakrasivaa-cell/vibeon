import Link from "next/link";
import { AuthShell } from "@/components/auth/AuthShell";
import { LogoMark } from "@/components/Logo";
import { TeacherJoin } from "@/components/auth/TeacherJoin";
import { db } from "@/lib/db";
import { getT } from "@/lib/i18n/server";
import { getSessionUser } from "@/lib/auth/session";
import { linkedOf } from "@/lib/auth/cabinet";

export const metadata = { title: "Приглашение преподавателя", robots: { index: false } };
export const dynamic = "force-dynamic";

/** Ссылка-приглашение преподавателя /ti/код: регистрация без писем на почту или кабинет учителя к входу ученика. */
export default async function TeacherInvitePage({ params }: { params: Promise<{ code: string }> }) {
  const { t } = await getT();
  const code = (await params).code.toLowerCase();
  const inv = await db.teacherInvite.findUnique({ where: { code } });
  const me = await getSessionUser();
  const myTeacher = me ? (me.role === "TEACHER" ? me : await linkedOf(me).then((x) => (x?.role === "TEACHER" ? x : null))) : null;

  // ссылку уже использовали (или она устарела)
  if (!inv || inv.usedAt || inv.expiresAt < new Date()) {
    const mine = !!inv?.usedBy && !!myTeacher && inv.usedBy === myTeacher.id;
    return (
      <AuthShell brand={false}>
        <section className="authcard text-center">
          <div className="pair"><LogoMark size={56} /></div>
          <h1>{mine ? t("tinv.mine.title") : t("tinv.bad.title")}</h1>
          <p className="mt-3 mb-5 text-text2">{mine ? t("tinv.mine.text") : t("tinv.bad.text")}</p>
          <Link href={mine ? "/teacher" : "/login"} className={mine ? "btn primary" : "alink"}>{mine ? t("tinv.goTeacher") : t("auth.back")}</Link>
        </section>
      </AuthShell>
    );
  }

  // у человека уже есть кабинет учителя — приглашение не нужно
  if (myTeacher) return (
    <AuthShell brand={false}>
      <section className="authcard text-center">
        <div className="pair"><LogoMark size={56} /></div>
        <h1>{t("tinv.has.title")}</h1>
        <p className="mt-3 mb-5 text-text2">{t("tinv.has.text")}</p>
        <Link href="/teacher" className="btn primary">{t("tinv.goTeacher")}</Link>
      </section>
    </AuthShell>
  );

  return (
    <AuthShell brand={false}>
      <section className="authcard" style={{ maxWidth: 480 }}>
        <div className="pair"><LogoMark size={56} /></div>
        <h1 className="text-center">{t("tinv.title", { name: inv.name })}</h1>
        <p className="sub text-center">{t("tinv.lead", { n: inv.days })}</p>
        <TeacherJoin code={code} init={{ name: inv.name, lastName: inv.lastName ?? "" }} signedIn={me ? { name: [me.name, me.lastName].filter(Boolean).join(" "), email: me.email } : null} />
      </section>
    </AuthShell>
  );
}
