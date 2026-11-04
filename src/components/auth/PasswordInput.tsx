"use client";
import { useState } from "react";
import { useT } from "@/lib/i18n/client";

type P = Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> & { id: string };

/** Поле пароля с кнопкой «показать / скрыть» — видно, что вводишь. */
export function PasswordInput(props: P) {
  const { t } = useT();
  const [show, setShow] = useState(false);
  return (
    <div className="pwwrap">
      <input {...props} type={show ? "text" : "password"} className={`input ${props.className ?? ""}`} />
      <button type="button" className="pweye" onClick={() => setShow(!show)} aria-label={show ? t("auth.pwHide") : t("auth.pwShow")} aria-pressed={show} title={show ? t("auth.pwHide") : t("auth.pwShow")}>
        {show ? (
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M3 3l18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M9.9 5.1A10.4 10.4 0 0 1 12 5c5 0 9 4.5 10 7-.4 1-1.3 2.5-2.7 3.8M6.1 6.1C4 7.5 2.6 9.6 2 12c1 2.5 5 7 10 7 1.7 0 3.2-.5 4.6-1.2" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
        ) : (
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M2 12c1-2.5 5-7 10-7s9 4.5 10 7c-1 2.5-5 7-10 7S3 14.5 2 12z" fill="none" stroke="currentColor" strokeWidth="1.8" /><circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" strokeWidth="1.8" /></svg>
        )}
      </button>
    </div>
  );
}

/** Новый пароль + «Повторите пароль» с подсказкой, если не совпадают. */
export function NewPassword({ label, hint, required = true }: { label: string; hint?: string; required?: boolean }) {
  const { t } = useT();
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  const mismatch = b.length > 0 && a !== b;
  const short = a.length > 0 && a.length < 8;
  return (
    <>
      <div className="field">
        <label htmlFor="password">{label}</label>
        <PasswordInput id="password" name="password" placeholder={t("auth.newPasswordPh")} autoComplete="new-password" minLength={8} required={required} value={a} onChange={(e) => setA(e.target.value)} />
        {short ? <span className="hint text-bad">{t("auth.err.password")}</span> : hint && <span className="hint">{hint}</span>}
      </div>
      <div className="field">
        <label htmlFor="password2">{t("auth.password2")}</label>
        <PasswordInput id="password2" name="password2" placeholder={t("auth.password2Ph")} autoComplete="new-password" required={required || a.length > 0} value={b} onChange={(e) => setB(e.target.value)} aria-invalid={mismatch} />
        {mismatch ? <span className="hint text-bad">{t("auth.err.mismatch")}</span> : b && a === b ? <span className="hint text-ok">✓ {t("auth.pwMatch")}</span> : null}
      </div>
    </>
  );
}
