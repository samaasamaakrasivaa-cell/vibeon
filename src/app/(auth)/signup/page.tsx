import Link from "next/link";
import { AuthShell } from "@/components/auth/AuthShell";
import { SignupForm } from "@/components/auth/SignupForm";
import { getT } from "@/lib/i18n/server";
import { oauthEnabled } from "@/lib/env";
import { redirectIfSignedIn } from "@/lib/auth/session";

export const metadata = { title: "Регистрация учителя" };

export default async function SignupPage() {
  await redirectIfSignedIn();
  const { t } = await getT();
  return (
    <AuthShell wordmark={false}>
      <section className="authcard">
        <h1>{t("auth.signup.title")}</h1>
        <p className="sub">{t("auth.signup.sub")}</p>
        <SignupForm oauth={oauthEnabled} />
      </section>
      <p className="authnote m-0">
        {t("auth.haveAccount")} <Link href="/login">{t("auth.signIn")}</Link>
      </p>
    </AuthShell>
  );
}
