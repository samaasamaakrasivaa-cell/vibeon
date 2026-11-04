"use client";
import { useEffect } from "react";

const STALE = /Server Action|ChunkLoadError|Loading chunk|Failed to fetch dynamically imported module|older or newer deployment/i;

/** Ошибка на странице. Если платформа обновилась, пока страница была открыта, — тихо перезагружаем (один раз). */
export function ErrorView({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const stale = STALE.test(error?.message ?? "");
  useEffect(() => {
    if (!stale) return;
    try {
      const k = "vo-reloaded", last = Number(sessionStorage.getItem(k) || 0);
      if (Date.now() - last > 30000) { sessionStorage.setItem(k, String(Date.now())); window.location.reload(); }
    } catch { window.location.reload(); }
  }, [stale]);
  const ru = typeof document === "undefined" || document.documentElement.lang !== "en";
  return (
    <div style={{ minHeight: "60vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24, fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" }}>
      <div style={{ maxWidth: 440, textAlign: "center" }}>
        <div style={{ fontSize: 40, marginBottom: 8 }}>{stale ? "✨" : "⚠️"}</div>
        <h2 style={{ margin: "0 0 8px" }}>{stale ? (ru ? "Платформа обновилась" : "VibeOn was updated") : (ru ? "Что-то пошло не так" : "Something went wrong")}</h2>
        <p style={{ color: "#6E6E73", margin: "0 0 20px", lineHeight: 1.5 }}>
          {stale ? (ru ? "Пока страница была открыта, вышла новая версия. Обновите страницу — введённое на ней придётся повторить." : "A new version came out while this page was open. Refresh the page.")
            : (ru ? "Попробуйте ещё раз. Если ошибка повторится, напишите нам и укажите код:" : "Please try again. If it happens again, contact us with this code:")}
          {!stale && error?.digest && <><br /><code>{error.digest}</code></>}
        </p>
        <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
          <button onClick={() => window.location.reload()} style={{ background: "#007AFF", color: "#fff", border: 0, borderRadius: 999, padding: "12px 22px", fontWeight: 600, fontSize: 15, cursor: "pointer" }}>{ru ? "Обновить страницу" : "Refresh"}</button>
          {!stale && <button onClick={() => reset()} style={{ background: "#E5E5EA", color: "#1C1C1E", border: 0, borderRadius: 999, padding: "12px 22px", fontWeight: 600, fontSize: 15, cursor: "pointer" }}>{ru ? "Попробовать снова" : "Try again"}</button>}
        </div>
      </div>
    </div>
  );
}
