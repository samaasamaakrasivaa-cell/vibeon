"use client";
// Плашка внизу экрана: оплату только что подтвердили — сутки её можно отменить (если нажали по ошибке).
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useT } from "@/lib/i18n/client";
import { undoPaid } from "@/lib/billing/actions";
import { Icon } from "../Icon";

type Item = { id: string; who: string; amount: string; title: string };
const KEY = "vibeon.paidHidden";

export function RecentPaidBar({ items }: { items: Item[] }) {
  const { t } = useT();
  const router = useRouter();
  const [hidden, setHidden] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => { try { setHidden(JSON.parse(localStorage.getItem(KEY) ?? "[]")); } catch { /* приватный режим */ } }, []);
  const hide = (id: string) => { const v = [...hidden, id].slice(-50); setHidden(v); try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* приватный режим */ } };
  const list = items.filter((x) => !hidden.includes(x.id)).slice(0, 3);
  if (!list.length) return null;
  return (
    <div className="paidbar" role="status">
      {list.map((x) => (
        <div key={x.id} className="paidbar-row">
          <span className="paidbar-ok"><Icon name="check" size="sm" /></span>
          <span className="grow min-w-0"><b className="block truncate">{t("pd.done", { who: x.who, sum: x.amount })}</b><span className="small muted truncate block">{x.title} · {t("pd.undoHint")}</span></span>
          <button type="button" className="btn plain sm" disabled={busy === x.id} onClick={async () => { if (!confirm(t("pd.undoQ"))) return; setBusy(x.id); await undoPaid(x.id); setBusy(null); router.refresh(); }}>{t("pd.undo")}</button>
          <button type="button" className="iconbtn" aria-label={t("common.close")} onClick={() => hide(x.id)}><Icon name="close" size="sm" /></button>
        </div>
      ))}
    </div>
  );
}
