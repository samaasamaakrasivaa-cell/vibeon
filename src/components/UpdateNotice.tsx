"use client";
import { useEffect, useRef, useState } from "react";
import { useT } from "@/lib/i18n/client";
import { Icon } from "./Icon";

const MINE = process.env.NEXT_PUBLIC_BUILD ?? "";
const EVERY = 3 * 60_000; // фоновая проверка
const GAP = 30_000; // не чаще, чем раз в 30 секунд при возврате на вкладку

/** Платформу обновили, а вкладка открыта со старой версией — кнопки на ней могут не сработать. Предлагаем обновить страницу. */
export function UpdateNotice() {
  const { t } = useT();
  const [stale, setStale] = useState(false);
  const [hidden, setHidden] = useState(false);
  const last = useRef(0);
  useEffect(() => {
    if (!MINE) return;
    const check = async (force = false) => {
      if (!force && Date.now() - last.current < GAP) return;
      last.current = Date.now();
      try {
        const r = await fetch("/api/version", { cache: "no-store" });
        if (!r.ok) return;
        const { v } = (await r.json()) as { v?: string };
        if (v && v !== MINE) setStale(true);
      } catch { /* нет сети — проверим позже */ }
    };
    const onVisible = () => { if (document.visibilityState === "visible") void check(); };
    // действие на странице не дошло до сервера (часто — как раз из-за обновления) — проверяем сразу
    const onFail = (e: PromiseRejectionEvent | ErrorEvent) => {
      const msg = String((e as PromiseRejectionEvent).reason?.message ?? (e as ErrorEvent).message ?? "");
      if (/server action|unexpected response|failed to fetch|load failed|chunk/i.test(msg)) void check(true);
    };
    const h = setInterval(() => void check(true), EVERY);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    window.addEventListener("unhandledrejection", onFail);
    window.addEventListener("error", onFail);
    return () => {
      clearInterval(h);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
      window.removeEventListener("unhandledrejection", onFail);
      window.removeEventListener("error", onFail);
    };
  }, []);
  if (!stale || hidden) return null;
  return (
    <div className="updnote" role="status">
      <Icon name="spark" size="sm" />
      <span className="grow">{t("upd.text")}</span>
      <button type="button" className="btn primary sm" onClick={() => location.reload()}>{t("upd.reload")}</button>
      <button type="button" className="iconbtn" aria-label={t("upd.later")} title={t("upd.later")} onClick={() => setHidden(true)}><Icon name="close" size="sm" /></button>
    </div>
  );
}
