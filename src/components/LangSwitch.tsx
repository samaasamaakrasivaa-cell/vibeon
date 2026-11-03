"use client";
import { useTransition } from "react";
import { setLang } from "@/lib/i18n/actions";
import type { LangCode } from "@/lib/i18n/dict";

export function LangSwitch({ lang, label }: { lang: LangCode; label: string }) {
  const [pending, start] = useTransition();
  return (
    <div className="seg xs" role="group" aria-label={label} style={{ opacity: pending ? 0.6 : 1 }}>
      {(["ru", "en"] as const).map((l) => (
        <button key={l} type="button" aria-pressed={lang === l} onClick={() => lang !== l && start(() => setLang(l))}>
          {l.toUpperCase()}
        </button>
      ))}
    </div>
  );
}
