"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useT } from "@/lib/i18n/client";
import { voteArticle } from "@/lib/admin/actions";

/** «Статья помогла?» — 👍 / 👎; голос запоминаем на устройстве, чтобы не голосовать дважды. */
export function Helpful({ id }: { id: string }) {
  const { t } = useT();
  const key = `vb.kbvote.${id}`;
  const [v, setV] = useState<"y" | "n" | null>(null);
  useEffect(() => { try { const x = localStorage.getItem(key); if (x === "y" || x === "n") setV(x); } catch { /* нет хранилища */ } }, [key]);
  const vote = (yes: boolean) => { setV(yes ? "y" : "n"); try { localStorage.setItem(key, yes ? "y" : "n"); } catch { /* ок */ } void voteArticle(id, yes); };
  return (
    <div className="helpful">
      {v ? <span className="small">{v === "y" ? t("pf.thanksYes") : <>{t("pf.thanksNo")} <Link href="/teacher/support" className="alink">{t("pf.askBtn")}</Link></>}</span> : (
        <>
          <span className="small muted">{t("pf.helpful")}</span>
          <button type="button" className="btn secondary sm" onClick={() => vote(true)}>👍 {t("pf.yes")}</button>
          <button type="button" className="btn secondary sm" onClick={() => vote(false)}>👎 {t("pf.no")}</button>
        </>
      )}
    </div>
  );
}
