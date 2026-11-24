"use client";
import { useState } from "react";
import { useT } from "@/lib/i18n/client";
import { switchCabinet } from "@/lib/admin/actions";
import { Icon } from "../Icon";

/** В кабинете тестового ученика: напоминание, что это проверка, и быстрый возврат в кабинет учителя. */
export function DemoBar() {
  const { t } = useT();
  const [busy, setBusy] = useState(false);
  return (
    <div className="demobar">
      <Icon name="eye" size="sm" />
      <span className="grow">{t("demo.bar")}</span>
      <button type="button" className="btn secondary sm" disabled={busy} onClick={async () => { setBusy(true); const r = await switchCabinet(); if (r.ok) window.location.href = r.href; else setBusy(false); }}>{t("demo.back")}</button>
    </div>
  );
}
