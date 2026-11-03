"use client";
import { useActionState, useState } from "react";
import { signupAction, type FormState } from "@/lib/auth/actions";
import { useT } from "@/lib/i18n/client";
import { Submit } from "./Submit";
import { OAuthButtons } from "./OAuthButtons";

export function SignupForm({ oauth }: { oauth: { yandex: boolean; vk: boolean } }) {
  const { t } = useT();
  const [st, action] = useActionState<FormState, FormData>(signupAction, undefined);
  const [consent, setConsent] = useState(false);
  return (
    <form action={action} className="authform" noValidate>
      {st?.error && <div className="alert" role="alert">{st.error}</div>}
      <div className="field">
        <label htmlFor="name">{t("auth.name")}</label>
        <input id="name" name="name" className="input" placeholder={t("auth.namePh")} autoComplete="given-name" defaultValue={st?.fields?.name} required />
      </div>
      <div className="field">
        <label htmlFor="email">{t("auth.email")}</label>
        <input id="email" name="email" type="email" className="input" placeholder="you@mail.ru" autoComplete="email" defaultValue={st?.fields?.email} required />
      </div>
      <div className="field">
        <label htmlFor="password">{t("auth.newPassword")}</label>
        <input id="password" name="password" type="password" className="input" placeholder={t("auth.newPasswordPh")} autoComplete="new-password" minLength={8} required />
      </div>
      <label className="consent">
        <input type="checkbox" name="consent" className="check" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
        <span>
          {t("auth.consent1")} <a className="alink" href="/legal/terms" target="_blank">{t("auth.terms")}</a> {t("auth.and")}{" "}
          <a className="alink" href="/legal/privacy" target="_blank">{t("auth.privacy")}</a>
        </span>
      </label>
      <Submit>{t("auth.create")}</Submit>
      <div className="divider">{t("auth.or")}</div>
      <OAuthButtons enabled={oauth} intent="signup" consent={consent} />
    </form>
  );
}
