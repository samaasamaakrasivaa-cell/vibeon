"use client";
import { useActionState } from "react";
import { forgotAction, resetAction, type FormState } from "@/lib/auth/actions";
import { useT } from "@/lib/i18n/client";
import { Submit } from "./Submit";

export function ForgotForm() {
  const { t } = useT();
  const [st, action] = useActionState<FormState, FormData>(forgotAction, undefined);
  return (
    <form action={action} className="authform" noValidate>
      {st?.error && <div className="alert" role="alert">{st.error}</div>}
      <div className="field">
        <label htmlFor="email">{t("auth.email")}</label>
        <input id="email" name="email" type="email" className="input" placeholder="you@mail.ru" autoComplete="email" defaultValue={st?.fields?.email} required />
      </div>
      <Submit>{t("auth.forgot.send")}</Submit>
    </form>
  );
}

export function ResetForm({ token }: { token: string }) {
  const { t } = useT();
  const [st, action] = useActionState<FormState, FormData>(resetAction, undefined);
  return (
    <form action={action} className="authform" noValidate>
      {st?.error && <div className="alert" role="alert">{st.error}</div>}
      <input type="hidden" name="token" value={token} />
      <div className="field">
        <label htmlFor="password">{t("auth.newPassword")}</label>
        <input id="password" name="password" type="password" className="input" placeholder={t("auth.newPasswordPh")} autoComplete="new-password" minLength={8} required />
      </div>
      <Submit>{t("auth.reset.save")}</Submit>
    </form>
  );
}
