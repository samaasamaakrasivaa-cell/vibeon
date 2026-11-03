"use client";
import { useActionState } from "react";
import { inviteFormAction, type FormState } from "@/lib/auth/actions";
import { useT } from "@/lib/i18n/client";
import { GOALS, SINCE, SKILLS } from "@/lib/onboarding";
import { Submit } from "./Submit";

type Init = { first: string; email: string };

export function OnboardForm({ token, init }: { token: string; init: Init }) {
  const { t, lang } = useT();
  const [st, action] = useActionState<FormState, FormData>(inviteFormAction.bind(null, token), undefined);
  const v = (k: string, d = "") => st?.fields?.[k] ?? d;
  const label = (x: [string, string]) => (lang === "en" ? x[1] : x[0]);
  const chips = (name: string, list: [string, string][], multi = true) => (
    <div className="chips">
      {list.map((x) => (
        <label className="chip" key={x[0]}>
          <input type={multi ? "checkbox" : "radio"} name={name} value={x[0]} />
          <span>{label(x)}</span>
        </label>
      ))}
    </div>
  );
  return (
    <form action={action} className="authform" noValidate>
      <div className="grid-2">
        <div className="field"><label htmlFor="first">{t("ob.first")} *</label><input id="first" name="first" className="input" autoComplete="given-name" defaultValue={v("first", init.first)} required /></div>
        <div className="field"><label htmlFor="last">{t("ob.last")} *</label><input id="last" name="last" className="input" autoComplete="family-name" defaultValue={v("last")} required /></div>
        <div className="field"><label htmlFor="email">{t("auth.email")} *</label><input id="email" name="email" type="email" className="input" autoComplete="email" defaultValue={v("email", init.email)} required /></div>
        <div className="field"><label htmlFor="phone">{t("ob.phone")} *</label><input id="phone" name="phone" type="tel" className="input" autoComplete="tel" placeholder="+7" defaultValue={v("phone")} required /></div>
      </div>
      <div className="field"><label htmlFor="bday">{t("ob.bday")}</label><input id="bday" name="bday" type="date" className="input" defaultValue={v("bday")} /></div>
      <div className="field"><span className="flabel">{t("ob.goals")}</span>{chips("goals", GOALS)}</div>
      <div className="field"><label htmlFor="other">{t("ob.other")}</label><input id="other" name="other" className="input" defaultValue={v("other")} /></div>
      <div className="field"><label htmlFor="about">{t("ob.about")}</label><textarea id="about" name="about" className="textarea input" defaultValue={v("about")} /></div>
      <div className="field"><span className="flabel">{t("ob.since")}</span>{chips("since", SINCE, false)}</div>
      <div className="field"><span className="flabel">{t("ob.easy")}</span>{chips("easy", SKILLS)}</div>
      <div className="field"><span className="flabel">{t("ob.hard")}</span>{chips("hard", SKILLS)}</div>
      <div className="field"><label htmlFor="problem">{t("ob.problem")}</label><textarea id="problem" name="problem" className="textarea input" placeholder={t("ob.problemPh")} defaultValue={v("problem")} /></div>
      <div className="field">
        <label htmlFor="password">{t("ob.password")}</label>
        <input id="password" name="password" type="password" className="input" placeholder={t("auth.newPasswordPh")} autoComplete="new-password" />
        <span className="hint">{t("ob.passwordHint")}</span>
      </div>
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
