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
        <p className="sub">{t("auth.forgot.sub")}</p>
        <ForgotForm />
        <p className="hint mt-4 mb-0">{t("auth.forgot.student")}</p>
      </section>
      <p className="authnote m-0"><Link href="/login">{t("auth.back")}</Link></p>
    </AuthShell>
  );
}
