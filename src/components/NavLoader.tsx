"use client";
import { useEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { LogoMark } from "./Logo";

/**
 * Экран загрузки с анимированным логотипом — только если переход длится дольше ~0,5 с (ТЗ, раздел 1).
 * Сделан на клиенте, а не через app/loading.tsx: корневой loading.tsx оборачивал все страницы в Suspense,
 * и после серверных действий Next.js иногда не применял обновлённую страницу.
 */
export function NavLoader() {
  const path = usePathname();
  const sp = useSearchParams();
  const [show, setShow] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    setShow(false);
  }, [path, sp]);
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as HTMLElement).closest("a");
      if (!a || a.target === "_blank" || a.hasAttribute("download")) return;
      const url = new URL(a.href, location.href);
      if (url.origin !== location.origin || (url.pathname === location.pathname && url.search === location.search)) return;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setShow(true), 500);
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);
  if (!show) return null;
  return (
    <div className="navloader" role="status" aria-label="Loading">
      <LogoMark size={64} animated />
    </div>
  );
}
