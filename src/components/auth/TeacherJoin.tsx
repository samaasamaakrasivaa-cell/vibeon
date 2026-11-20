"use client";
import { useActionState, useState, useTransition } from "react";
import { joinAsSignedIn, joinNew, joinWithLogin, notMe, type TiState } from "@/lib/auth/teacher-invite";
import { useT } from "@/lib/i18n/client";
import { NewPassword, PasswordInput } from "./PasswordInput";
import { Submit } from "./Submit";

/** Приглашение учителя: новый человек регистрируется; у кого уже есть вход ученика — подключает к нему кабинет учителя. */
export function TeacherJoin({ code, init, signedIn }: { code: string; init: { name: string; lastName: string }; signedIn: { name: string; email: string } | null }) {
  const { t } = useT();
  const [mode, setMode] = useState<"new" | "have">("new");
  const [ns, newAction] = useActionState<TiState, FormData>(joinNew.bind(null, code), undefined);
  const [hs, haveAction] = useActionState<TiState, FormData>(joinWithLogin.bind(null, code), undefined);
  const [here, setHere] = useState<TiState>(undefined);
  const [pending, start] = useTransition();

  // уже вошли в кабинет ученика — одна кнопка
  if (signedIn) return (
    <div className="authform">
      {here?.error && <div className="alert" role="alert">{here.error}</div>}
      <p className="m-0 text-text2">{t("tinv.signedIn", { name: signedIn.name, email: signedIn.email })}</p>
      <button type="button" className="btn primary block" disabled={pending} onClick={() => start(async () => setHere(await joinAsSignedIn(code)))}>{t("tinv.attach")}</button>
      <p className="small muted m-0">{t("tinv.attachNote")}</p>
      <form action={notMe.bind(null, code)} className="text-center"><button type="submit" className="alink text-[14px]">{t("tinv.notMe")}</button></form>
    </div>
  );

  return (
    <div className="mt-2 flex flex-col gap-4">
      <div className="seg w-full" role="group" aria-label={t("tinv.how")}>
        <button type="button" className="grow" aria-pressed={mode === "new"} onClick={() => setMode("new")}>{t("tinv.modeNew")}</button>
        <button type="button" className="grow" aria-pressed={mode === "have"} onClick={() => setMode("have")}>{t("tinv.modeHave")}</button>
      </div>
      {mode === "new" ? (
        <form action={newAction} className="authform" noValidate>
          {ns?.error && <div className="alert" role="alert">{ns.error}</div>}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="field"><label htmlFor="ti-n">{t("ob.first")}</label><input id="ti-n" name="name" className="input" autoComplete="given-name" defaultValue={ns?.fields?.name ?? init.name} required /></div>
            <div className="field"><label htmlFor="ti-l">{t("ob.last")}</label><input id="ti-l" name="lastName" className="input" autoComplete="family-name" defaultValue={ns?.fields?.lastName ?? init.lastName} /></div>
          </div>
          <div className="field">
            <label htmlFor="ti-e">{t("tinv.loginEmail")}</label>
            <input id="ti-e" name="email" type="email" className="input" placeholder="you@mail.ru" autoComplete="email" defaultValue={ns?.fields?.email} required />
            <span className="small muted">{t("tinv.loginEmailHint")}</span>
          </div>
          <NewPassword label={t("auth.newPassword")} />
          <label className="consent">
            <input key={ns?.fields?.consent ?? "0"} type="checkbox" name="consent" className="check" defaultChecked={ns?.fields?.consent === "on"} />
            <span>{t("auth.consent1")} <a className="alink" href="/legal/terms" target="_blank">{t("auth.terms")}</a> {t("auth.and")} <a className="alink" href="/legal/privacy" target="_blank">{t("auth.privacy")}</a></span>
          </label>
          <Submit>{t("tinv.create")}</Submit>
        </form>
      ) : (
        <form action={haveAction} className="authform" noValidate>
          <p className="small muted m-0">{t("tinv.haveLead")}</p>
          {hs?.error && <div className="alert" role="alert">{hs.error}</div>}
          <div className="field"><label htmlFor="ti-he">{t("auth.email")}</label><input id="ti-he" name="email" type="email" className="input" placeholder="you@mail.ru" autoComplete="email" defaultValue={hs?.fields?.email} required /></div>
          <div className="field"><label htmlFor="ti-hp">{t("auth.password")}</label><PasswordInput id="ti-hp" name="password" placeholder="••••••••" autoComplete="current-password" /></div>
          <Submit>{t("tinv.attach")}</Submit>
          <p className="small muted m-0">{t("tinv.attachNote")}</p>
        </form>
      )}
    </div>
  );
}
