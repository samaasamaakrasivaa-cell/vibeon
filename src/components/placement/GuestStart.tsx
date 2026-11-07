"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useT } from "@/lib/i18n/client";
import type { DictKey } from "@/lib/i18n/dict";
import { startGuest } from "@/lib/placement/actions";

export function GuestStart({ code }: { code: string }) {
  const { t } = useT();
  const router = useRouter();
  const [f, setF] = useState({ name: "", contact: "" });
  const [consent, setConsent] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const go = (e: React.FormEvent) => {
    e.preventDefault();
    start(async () => {
      setErr(null);
      const r = await startGuest(code, f.name, f.contact, consent);
      if (!r.ok) return setErr(t(`pl.gerr.${r.error}` as DictKey));
      router.push(`/placement/${r.id}`);
    });
  };
  return (
    <form className="flex flex-col gap-3" onSubmit={go}>
      <div className="field"><label htmlFor="g-name">{t("pl.guestName")}</label><input id="g-name" className="input" autoComplete="name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required maxLength={80} /></div>
      <div className="field"><label htmlFor="g-c">{t("pl.guestContact")}</label><input id="g-c" className="input" placeholder={t("pl.guestContactPh")} value={f.contact} onChange={(e) => setF({ ...f, contact: e.target.value })} required maxLength={120} /></div>
      <label className="consent">
        <input type="checkbox" className="check" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
        <span>{t("pl.guestConsent")} <a className="alink" href="/legal/privacy" target="_blank">{t("auth.privacy")}</a></span>
      </label>
      {err && <div className="alert">{err}</div>}
      <button className="btn primary" disabled={pending || !consent}>{t("pl.guestStart")}</button>
    </form>
  );
}
