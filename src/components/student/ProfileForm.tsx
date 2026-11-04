"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { changePassword, updateMyProfile } from "@/lib/student/actions";
import { useT } from "@/lib/i18n/client";
import { TIMEZONES } from "@/lib/time";

export function ProfileForm({ init, hasPassword }: { init: { name: string; lastName: string; phone: string; telegram: string; timezone: string; email: string }; hasPassword: boolean }) {
  const { t } = useT();
  const router = useRouter();
  const [f, setF] = useState(init);
  const [msg, setMsg] = useState<string | null>(null);
  const [pw, setPw] = useState({ old: "", new: "" });
  const [pwMsg, setPwMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const field = (k: keyof typeof f, label: string, type = "text") => (
    <div className="field"><label htmlFor={`p-${k}`}>{label}</label><input id={`p-${k}`} type={type} className="input" value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} disabled={k === "email"} /></div>
  );
  return (
    <>
      <section className="card">
        <h2 className="mb-4">{t("prf.data")}</h2>
        <div className="grid-2">
          {field("name", t("ob.first"))}{field("lastName", t("ob.last"))}{field("email", t("auth.email"))}{field("phone", t("ob.phone"), "tel")}{field("telegram", "Telegram")}
          <div className="field"><label htmlFor="p-tz">{t("prof.tz")}</label><select id="p-tz" className="select" value={f.timezone} onChange={(e) => setF({ ...f, timezone: e.target.value })}>{TIMEZONES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
        </div>
        <div className="mt-4 flex items-center gap-3">
          <button className="btn primary" disabled={pending} onClick={() => start(async () => { const r = await updateMyProfile(f); setMsg(r.ok ? `✓ ${t("common.saved")}` : r.error); })}>{t("common.save")}</button>
          {msg && <span className="small">{msg}</span>}
        </div>
      </section>
      <section className="card">
        <h2 className="mb-4">{t("prf.password")}</h2>
        <div className="grid-2">
          {hasPassword && <div className="field"><label htmlFor="pw-o">{t("prf.oldPw")}</label><input id="pw-o" type="password" className="input" value={pw.old} onChange={(e) => setPw({ ...pw, old: e.target.value })} autoComplete="current-password" /></div>}
          <div className="field"><label htmlFor="pw-n">{t("auth.newPassword")}</label><input id="pw-n" type="password" className="input" value={pw.new} onChange={(e) => setPw({ ...pw, new: e.target.value })} placeholder={t("auth.newPasswordPh")} autoComplete="new-password" /></div>
        </div>
        <div className="mt-4 flex items-center gap-3">
          <button className="btn secondary" disabled={pending || !pw.new} onClick={() => start(async () => { const r = await changePassword(pw.old, pw.new); setPwMsg(r.ok ? `✓ ${t("common.saved")}` : r.error); if (r.ok) setPw({ old: "", new: "" }); })}>{t("prf.changePw")}</button>
          {pwMsg && <span className="small">{pwMsg}</span>}
        </div>
      </section>
    </>
  );
}
