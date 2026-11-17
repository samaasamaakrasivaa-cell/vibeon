"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { switchCabinet } from "@/lib/admin/actions";
import { useT } from "@/lib/i18n/client";
import { Icon } from "./Icon";

export type Cabinet = { href: string; label: string; current: boolean };

/** Шапка: «Кабинет учителя ▾» → администратор / второй кабинет (ученика) того же человека. */
export function CabinetSwitch({ items, linked }: { items: Cabinet[]; linked: { label: string; email: string } | null }) {
  const { t } = useT();
  const ref = useRef<HTMLDetailsElement>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && ref.current.removeAttribute("open");
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, []);
  const cur = items.find((x) => x.current) ?? items[0];
  const go = async () => { setBusy(true); const r = await switchCabinet(); if (r.ok) window.location.href = r.href; else setBusy(false); };
  return (
    <details className="cabsw" ref={ref}>
      <summary className="hsub" title={t("cab.switch")}>{cur?.label}<Icon name="chevd" size="sm" /></summary>
      <div className="pop">
        <span className="small muted cabsw-h">{t("cab.switch")}</span>
        {items.map((x) => (
          <Link key={x.href} href={x.href} aria-current={x.current ? "page" : undefined} onClick={() => ref.current?.removeAttribute("open")}>
            <span className="grow">{x.label}</span>{x.current && <Icon name="check" size="sm" />}
          </Link>
        ))}
        {linked && (
          <button type="button" disabled={busy} onClick={go}>
            <span className="grow">{linked.label}<br /><span className="small muted">{linked.email}</span></span><Icon name="right" size="sm" />
          </button>
        )}
      </div>
    </details>
  );
}
