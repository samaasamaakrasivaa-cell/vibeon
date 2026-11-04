"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useT } from "@/lib/i18n/client";
import { linkTelegram, saveNotify, testTelegram, unlinkTelegram } from "@/lib/notify/actions";
import { CATS, LEADS, type Cat, type NotifySettings as S } from "@/lib/notify/settings";
import { Icon } from "./Icon";

/** «Уведомления»: Telegram, что присылать в Telegram и на почту, напоминание об уроке, тихие часы. */
export function NotifySettings({ init, linked, enabled, email, role }: { init: S; linked: boolean; enabled: boolean; email: string; role: "TEACHER" | "STUDENT" }) {
  const { t } = useT();
  const router = useRouter();
  const [s, setS] = useState<S>(init);
  const [saved, setSaved] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const save = (next: S) => { setS(next); setSaved(false); start(async () => { await saveNotify(next); setSaved(true); }); };
  const toggle = (ch: "tg" | "email", c: Cat) => save({ ...s, [ch]: { ...s[ch], [c]: !s[ch][c] } });
  const cats = CATS.filter((c) => role === "STUDENT" || c !== "words");
  const hours = Array.from({ length: 24 }, (_, i) => i);
  return (
    <section className="card" id="notify">
      <h2 className="mb-1">{t("nf.title")}</h2>
      <p className="muted mt-0">{t("nf.lead")}</p>

      <div className="tgbox">
        <span className="tgico"><Icon name="telegram" /></span>
        <div className="grow">
          <b>Telegram</b>
          <div className="small muted">{!enabled ? t("nf.tgOff") : linked ? t("nf.tgOn") : t("nf.tgHint")}</div>
        </div>
        {enabled && (linked ? (
          <div className="flex flex-wrap gap-2">
            <button className="btn secondary sm" disabled={pending} onClick={() => start(async () => { const r = await testTelegram(); setMsg(r.ok ? t("nf.testSent") : r.error); })}>{t("nf.test")}</button>
            <button className="btn plain sm" disabled={pending} onClick={() => start(async () => { await unlinkTelegram(); setTimeout(() => router.refresh(), 0); })}>{t("nf.unlink")}</button>
          </div>
        ) : (
          <button className="btn primary sm" disabled={pending} onClick={() => start(async () => { const r = await linkTelegram(); if (r.ok && r.url) { window.open(r.url, "_blank"); setMsg(t("nf.afterLink")); } })}><Icon name="telegram" size="sm" />{t("tg.connect")}</button>
        ))}
      </div>
      {msg && <div className="alert ok mt-2">{msg} {!linked && enabled && <button className="paylink" onClick={() => router.refresh()}>{t("nf.refresh")}</button>}</div>}

      <table className="nftable mt-4">
        <thead><tr><th>{t("nf.what")}</th><th>Telegram</th><th>{t("nf.email")}</th></tr></thead>
        <tbody>
          {cats.map((c) => (
            <tr key={c}>
              <td><b>{t(`nf.c.${c}`)}</b><div className="small muted">{t(`nf.d.${c}`)}</div></td>
              <td><label className="switch"><input type="checkbox" aria-label={`Telegram: ${t(`nf.c.${c}`)}`} checked={!!s.tg[c]} disabled={!enabled} onChange={() => toggle("tg", c)} /><span /></label></td>
              <td><label className="switch"><input type="checkbox" aria-label={`${t("nf.email")}: ${t(`nf.c.${c}`)}`} checked={!!s.email[c]} onChange={() => toggle("email", c)} /><span /></label></td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="hint">{t("nf.emailTo", { email })}</p>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="field">
          <label htmlFor="nf-lead">{t("nf.leadL")}</label>
          <select id="nf-lead" className="select" value={s.lessonLead} onChange={(e) => save({ ...s, lessonLead: Number(e.target.value) })}>
            {LEADS.map((m) => <option key={m} value={m}>{m === 0 ? t("nf.leadOff") : m === 1440 ? t("nf.lead24") : m >= 60 ? t("nf.leadH", { n: m / 60 }) : t("nf.leadM", { n: m })}</option>)}
          </select>
        </div>
        <div className="field">
          <span className="flabel">{t("nf.quiet")}</span>
          <div className="flex items-center gap-2">
            <label className="switch"><input type="checkbox" aria-label={t("nf.quiet")} checked={!!s.quiet} onChange={(e) => save({ ...s, quiet: e.target.checked ? [22, 8] : null })} /><span /></label>
            {s.quiet && <>
              <select className="select" style={{ width: 96 }} aria-label={t("nf.from")} value={s.quiet[0]} onChange={(e) => save({ ...s, quiet: [Number(e.target.value), s.quiet![1]] })}>{hours.map((h) => <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>)}</select>
              <span>—</span>
              <select className="select" style={{ width: 96 }} aria-label={t("nf.to")} value={s.quiet[1]} onChange={(e) => save({ ...s, quiet: [s.quiet![0], Number(e.target.value)] })}>{hours.map((h) => <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>)}</select>
            </>}
          </div>
          <span className="hint">{t("nf.quietHint")}</span>
        </div>
      </div>
      {role === "STUDENT" && <p className="hint mb-0">{t("nf.wordsHint")}</p>}
      <div className="small mt-2" style={{ color: saved ? "var(--ok)" : "var(--text3)" }}>{pending ? t("common.saving") : saved ? `✓ ${t("common.saved")}` : " "}</div>
    </section>
  );
}
