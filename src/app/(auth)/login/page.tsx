import Link from "next/link";
import { AuthShell } from "@/components/auth/AuthShell";
import { LoginForm } from "@/components/auth/LoginForm";
import { Icon } from "@/components/Icon";
import { getT } from "@/lib/i18n/server";
import { env, oauthEnabled } from "@/lib/env";
import { redirectIfSignedIn } from "@/lib/auth/session";
import { providerLabel, type Provider } from "@/lib/auth/oauth";
import type { DictKey } from "@/lib/i18n/dict";

export const metadata = { title: "Вход" };

const ERR: Record<string, DictKey> = { link: "auth.err.link", noaccount: "auth.err.noaccount", oauth: "auth.err.oauth", oauthEmail: "auth.err.oauthEmail" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string; p?: string; next?: string }> }) {
  await redirectIfSignedIn();
  const { t } = await getT();
  const sp = await searchParams;
  const err = sp.error && ERR[sp.error] ? t(ERR[sp.error], { p: providerLabel[sp.p as Provider] ?? "" }) : undefined;
  return (
    <AuthShell>
      <section className="authcard">
        <h1>{t("auth.login.title")}</h1>
        <LoginForm oauth={oauthEnabled} initialError={err} next={sp.next} />
      </section>
      <Link href="/signup" className="ctacard">
        <span className="ico"><Icon name="class" /></span>
        <span className="grow flex-1">
          <b className="block">{t("auth.teacherCta")}</b>
          <span className="text-[13px] text-text2">{t("auth.teacherCtaSub", { n: env.trialDays })}</span>
        </span>
        <Icon name="right" className="text-text3" />
      </Link>
      <p className="authnote m-0">
        {t("auth.studentNote")} <Link href="/invite/preview">{t("auth.studentNoteLink")}</Link>
      </p>
    </AuthShell>
  );
}
