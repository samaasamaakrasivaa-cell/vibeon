import Link from "next/link";
import { AuthShell } from "@/components/auth/AuthShell";
import { LogoMark } from "@/components/Logo";
import { getT } from "@/lib/i18n/server";
import { getValidInvite, initials } from "@/lib/invite";

export const metadata = { title: "Приглашение" };

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { t, lang } = await getT();
  const { token } = await params;
  const preview = token === "preview";
  const inv = preview ? null : await getValidInvite(token);

  if (!preview && !inv)
    return (
      <AuthShell brand={false}>
        <section className="authcard text-center">
          <div className="pair"><LogoMark size={56} /></div>
          <h1>{t("inv.bad.title")}</h1>
          <p className="mt-3 mb-5 text-text2">{t("inv.bad.text")}</p>
          <Link href="/login" className="alink">{t("auth.back")}</Link>
        </section>
      </AuthShell>
    );

  const student = preview ? (lang === "en" ? "Anna" : "Анна") : inv!.student.name;
  const tu = preview ? { name: lang === "en" ? "Elvira" : "Эльвира", lastName: lang === "en" ? "Kuznetsova" : "Кузнецова" } : inv!.teacher.user;
  return (
    <AuthShell brand={false}>
      <section className="authcard text-center" style={{ maxWidth: 440 }}>
        <div className="pair">
          <LogoMark size={56} />
          <span className="avatar">{initials(tu.name, tu.lastName)}</span>
        </div>
        <h1>{t("inv.title", { name: student })}</h1>
        <p className="mt-3 mb-5 text-[16px] leading-normal text-text2">
          <b className="text-text">{[tu.name, tu.lastName].filter(Boolean).join(" ")}</b> {t("inv.text")}
        </p>
        {preview ? (
          <span className="btn primary w-full" aria-disabled="true" style={{ borderRadius: 14, minHeight: 50, opacity: 0.6 }}>{t("inv.fill")}</span>
        ) : (
          <Link href={`/invite/${token}/form`} className="btn primary w-full" style={{ borderRadius: 14, minHeight: 50, fontSize: 17 }}>{t("inv.fill")}</Link>
        )}
        <p className="mt-4 mb-3 text-[13px] text-text2">{preview ? t("inv.preview") : t("inv.note")}</p>
        <Link href="/login" className="alink text-[14px]">{t("inv.have")}</Link>
      </section>
    </AuthShell>
  );
}
