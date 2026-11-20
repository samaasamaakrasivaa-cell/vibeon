"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useT } from "@/lib/i18n/client";
import { linkCabinet, switchCabinet, unlinkCabinet } from "@/lib/admin/actions";

/** Профиль → «Второй кабинет»: тот же человек — учитель и ученик; привязка паролем от второго кабинета. */
export function LinkCabinet({ linked }: { linked: { role: "TEACHER" | "STUDENT"; email: string; shared?: boolean } | null }) {
  const { t } = useT();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const role = (r: string) => (r === "TEACHER" ? t("ws.teacher") : t("ws.student"));
  return (
    <section className="card" id="cabinet">
      <h2 className="mb-1">{t("cab.title")}</h2>
      <p className="small muted mt-0">{t("cab.hint")}</p>
      {linked ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="grow">{linked.shared ? t("cab.shared", { r: role(linked.role) }) : t("cab.linked", { r: role(linked.role), e: linked.email })}</span>
          <button type="button" className="btn primary sm" disabled={busy} onClick={async () => { setBusy(true); const r = await switchCabinet(); if (r.ok) window.location.href = r.href; else setBusy(false); }}>{t("cab.go")}</button>
          {!linked.shared && <button type="button" className="btn plain sm" disabled={busy} onClick={async () => { setBusy(true); await unlinkCabinet(); setBusy(false); router.refresh(); }}>{t("cab.unlink")}</button>}
        </div>
      ) : (
        <form className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end" onSubmit={async (e) => { e.preventDefault(); setBusy(true); setErr(null); const r = await linkCabinet(email, pw); setBusy(false); if (!r.ok) setErr(r.error); else { setPw(""); router.refresh(); } }}>
          <div className="field"><label htmlFor="cab-e">{t("cab.email")}</label><input id="cab-e" className="input" type="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
          <div className="field"><label htmlFor="cab-p">{t("cab.password")}</label><input id="cab-p" className="input" type="password" autoComplete="off" value={pw} onChange={(e) => setPw(e.target.value)} /></div>
          <button type="submit" className="btn secondary" disabled={busy || !email || !pw}>{t("cab.link")}</button>
          {err && <div className="alert sm:col-span-3">{t(err === "role" ? "cab.err.role" : "cab.err.auth")}</div>}
        </form>
      )}
    </section>
  );
}
