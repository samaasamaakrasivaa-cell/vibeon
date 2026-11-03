import Link from "next/link";
import { AuthShell } from "@/components/auth/AuthShell";
import { ResetForm } from "@/components/auth/ForgotForm";
import { getT } from "@/lib/i18n/server";

export const metadata = { title: "Новый пароль" };

export default async function Reset({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { t } = await getT();
  const token = (await searchParams).token ?? "";
  return (
    <AuthShell wordmark={false}>
      <section className="authcard">
        <h1>{t("auth.reset.title")}</h1>
        {token ? <ResetForm token={token} /> : <div className="alert mt-4">{t("auth.reset.bad")}</div>}
      </section>
      <p className="authnote m-0"><Link href="/login">{t("auth.back")}</Link></p>
    </AuthShell>
  );
}
