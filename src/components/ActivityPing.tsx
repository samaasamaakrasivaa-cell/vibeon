"use client";
import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

/** Учёт активного времени ученика: раз в минуту, если в эту минуту он что-то делал (нажатия, ввод, прокрутка, переходы)
 *  и вкладка на экране. Просто открытая в фоне платформа не считается. */
export function ActivityPing({ cls = false }: { cls?: boolean }) {
  const active = useRef(true); // открыл страницу — уже действие
  const path = usePathname();
  useEffect(() => { active.current = true; }, [path]);
  useEffect(() => {
    const on = () => { active.current = true; };
    const evs = ["pointerdown", "keydown", "wheel", "touchstart", "input"] as const;
    evs.forEach((e) => window.addEventListener(e, on, { passive: true }));
    const ping = () => {
      if (!active.current || document.hidden) return;
      active.current = false;
      void fetch("/api/activity", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ cls }), keepalive: true }).catch(() => {});
    };
    const first = setTimeout(ping, 3000);
    const id = setInterval(ping, 60_000);
    return () => { evs.forEach((e) => window.removeEventListener(e, on)); clearTimeout(first); clearInterval(id); };
  }, [cls]);
  return null;
}
