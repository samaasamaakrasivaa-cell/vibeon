"use client";
import { useActionState } from "react";
import { NewPassword } from "./PasswordInput";
import { inviteFormAction, type FormState } from "@/lib/auth/actions";
import { useT } from "@/lib/i18n/client";
import { LearningFields } from "@/components/student/LearningFields";
import { Submit } from "./Submit";

type Init = { first: string; email: string };

export function OnboardForm({ token, init }: { token: string; init: Init }) {
  const { t } = useT();
  const [st, action] = useActionState<FormState, FormData>(inviteFormAction.bind(null, token), undefined);
  const v = (k: string, d = "") => st?.fields?.[k] ?? d;
  return (
    <form action={action} className="authform" noValidate>
      <div className="grid-2">
        <div className="field"><label htmlFor="first">{t("ob.first")} *</label><input id="first" name="first" className="input" autoComplete="given-name" defaultValue={v("first", init.first)} required /></div>
        <div className="field"><label htmlFor="last">{t("ob.last")} *</label><input id="last" name="last" className="input" autoComplete="family-name" defaultValue={v("last")} required /></div>
        <div className="field"><label htmlFor="email">{t("auth.email")} *</label><input id="email" name="email" type="email" className="input" autoComplete="email" defaultValue={v("email", init.email)} required /></div>
        <div className="field"><label htmlFor="phone">{t("ob.phone")} *</label><input id="phone" name="phone" type="tel" className="input" autoComplete="tel" placeholder="+7" defaultValue={v("phone")} required /></div>
      </div>
      <div className="field"><label htmlFor="bday">{t("ob.bday")}</label><input id="bday" name="bday" type="date" className="input" defaultValue={v("bday")} /></div>
      <LearningFields answers={{ otherGoal: v("other"), about: v("about"), since: v("since"), problem: v("problem") }} />
      <NewPassword label={`${t("ob.password")} *`} hint={t("ob.passwordHint")} />
      <label className="consent">
        <input type="checkbox" name="consent" className="check" />
        <span>
          {t("auth.consent1")} <a className="alink" href="/legal/terms" target="_blank">{t("auth.terms")}</a> {t("auth.and")}{" "}
          <a className="alink" href="/legal/privacy" target="_blank">{t("auth.privacy")}</a>
        </span>
      </label>
      {st?.error && <div className="alert" role="alert">{st.error}</div>}
      <Submit>{t("ob.continue")}</Submit>
      <div className="steps">{t("ob.step", { n: 1 })}</div>
    </form>
  );
}
