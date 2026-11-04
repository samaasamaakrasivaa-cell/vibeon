"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { changePassword, updateMyProfile } from "@/lib/student/actions";
import { updateTeacherProfile } from "@/lib/teacher/actions";
import { useT } from "@/lib/i18n/client";
import { TIMEZONES } from "@/lib/time";
import { PasswordInput } from "@/components/auth/PasswordInput";

export function ProfileForm({ init, hasPassword, teacher }: { init: { name: string; lastName: string; phone: string; telegram: string; timezone: string; email: string; callLink?: string }; hasPassword: boolean; teacher?: boolean }) {
  const { t } = useT();
  const router = useRouter();
  const [f, setF] = useState(init);
  const [msg, setMsg] = useState<string | null>(null);
  const [pw, setPw] = useState({ old: "", new: "", new2: "" });
  const mismatch = pw.new2.length > 0 && pw.new !== pw.new2;
  const [pwMsg, setPwMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [f2, setF2] = useState({ callLink: init.callLink ?? "" });
  const field = (k: Exclude<keyof typeof f, "callLink">, label: string, type = "text") => (
    <div className="field"><label htmlFor={`p-${k}`}>{label}</label><input id={`p-${k}`} type={type} className="input" value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} disabled={k === "email"} /></div>
  );
  return (
    <>
      <section className="card">
        <h2 className="mb-4">{t("prf.data")}</h2>
        <div className="grid-2">
          {field("name", t("ob.first"))}{field("lastName", t("ob.last"))}{field("email", t("auth.email"))}{field("phone", t("ob.phone"), "tel")}{teacher ? <div className="field"><label htmlFor="p-call">{t("tp.callLink")}</label><input id="p-call" className="input" value={f2.callLink} placeholder="https://telemost.yandex.ru/…" onChange={(e) => setF2({ callLink: e.target.value })} /></div> : field("telegram", "Telegram")}
          <div className="field"><label htmlFor="p-tz">{t("prof.tz")}</label><select id="p-tz" className="select" value={f.timezone} onChange={(e) => setF({ ...f, timezone: e.target.value })}>{TIMEZONES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
        </div>
        <div className="mt-4 flex items-center gap-3">
          <button className="btn primary" disabled={pending} onClick={() => start(async () => { const r = teacher ? await updateTeacherProfile({ ...f, callLink: f2.callLink }) : await updateMyProfile(f); setMsg(r.ok ? `✓ ${t("common.saved")}` : r.error); })}>{t("common.save")}</button>
          {msg && <span className="small">{msg}</span>}
        </div>
      </section>
      <section className="card">
        <h2 className="mb-4">{t("prf.password")}</h2>
        <div className="grid-2">
          {hasPassword && <div className="field"><label htmlFor="pw-o">{t("prf.oldPw")}</label><PasswordInput id="pw-o" value={pw.old} onChange={(e) => setPw({ ...pw, old: e.target.value })} autoComplete="current-password" /></div>}
          <div className="field"><label htmlFor="pw-n">{t("auth.newPassword")}</label><PasswordInput id="pw-n" value={pw.new} onChange={(e) => setPw({ ...pw, new: e.target.value })} placeholder={t("auth.newPasswordPh")} autoComplete="new-password" />{pw.new.length > 0 && pw.new.length < 8 && <span className="hint text-bad">{t("auth.err.password")}</span>}</div>
          <div className="field"><label htmlFor="pw-n2">{t("auth.password2")}</label><PasswordInput id="pw-n2" value={pw.new2} onChange={(e) => setPw({ ...pw, new2: e.target.value })} placeholder={t("auth.password2Ph")} autoComplete="new-password" aria-invalid={mismatch} />{mismatch ? <span className="hint text-bad">{t("auth.err.mismatch")}</span> : pw.new2 && pw.new === pw.new2 ? <span className="hint text-ok">✓ {t("auth.pwMatch")}</span> : null}</div>
        </div>
        <div className="mt-4 flex items-center gap-3">
          <button className="btn secondary" disabled={pending || pw.new.length < 8 || pw.new !== pw.new2 || (hasPassword && !pw.old)} onClick={() => start(async () => { const r = await changePassword(pw.old, pw.new); setPwMsg(r.ok ? `✓ ${t("common.saved")}` : r.error); if (r.ok) setPw({ old: "", new: "", new2: "" }); })}>{t("prf.changePw")}</button>
          {pwMsg && <span className="small">{pwMsg}</span>}
        </div>
      </section>
    </>
  );
}
