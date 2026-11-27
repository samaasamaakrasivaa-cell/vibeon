"use client";
import { useState, useTransition } from "react";
import { useT } from "@/lib/i18n/client";
import { sendReport } from "@/lib/placement/actions";
import type { PublicationStamp } from "@/lib/placement/report-publication";

export function HidePublishedReport({ id, expected }: { id: string; expected: PublicationStamp }) {
  const { t } = useT();
  const [pending, start] = useTransition();
  const [error, setError] = useState(false);
  return (
    <div className="mb-5 flex flex-wrap items-center gap-2">
      <button type="button" className="btn plain sm" disabled={pending} onClick={() => start(async () => {
        setError(false);
        const result = await sendReport(id, { on: false, expected }).catch(() => null);
        setError(!result?.ok);
      })}>{t("rp.unsend")}</button>
      {error && <span className="small" role="status">{t("rp.reportChanged")}</span>}
    </div>
  );
}
