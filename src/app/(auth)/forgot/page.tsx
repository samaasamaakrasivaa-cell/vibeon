import Link from "next/link";
import { AuthShell } from "@/components/auth/AuthShell";
import { ForgotForm } from "@/components/auth/ForgotForm";
import { getT } from "@/lib/i18n/server";

export const metadata = { title: "Новый пароль" };

export default async function Forgot() {
  const { t } = await getT();
  return (
    <AuthShell wordmark={false}>
      <section className="authcard">
        <h1>{t("auth.forgot.title")}</h1>
        <div className="forgotst mt-5">
          <span className="fsicon">🎓</span>
          <div><b className="block">{t("auth.forgot.stTitle")}</b><span className="small muted">{t("auth.forgot.student")}</span></div>
        </div>
        <p className="small font-semibold mt-6 mb-1">{t("auth.forgot.teacherTitle")}</p>
        <p className="small muted mt-0 mb-3 text-left">{t("auth.forgot.sub")}</p>
        <ForgotForm />
      </section>
      <p className="authnote m-0"><Link href="/login">{t("auth.back")}</Link></p>
    </AuthShell>
  );
}
