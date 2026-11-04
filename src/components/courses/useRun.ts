"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

type Res = { ok: true; id?: string; token?: string } | { ok: false; error: string };

/** Запуск серверного действия с обновлением страницы и текстом ошибки. */
export function useRun() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  /** navigates: после действия будет переход на другую страницу — тогда текущую не обновляем, чтобы не мешать переходу. */
  const run = (fn: () => Promise<Res>, after?: (r: Res & { ok: true }) => void, navigates = false) =>
    start(async () => {
      setError(null);
      const r = await fn().catch(() => ({ ok: false as const, error: "Error" }));
      if (!r.ok) return setError(r.error);
      // Обновление страницы — после завершения действия, вне этой операции (внутри неё два обновления
      // иногда блокировали друг друга). Само действие тоже обновляет страницу через revalidatePath.
      if (!navigates) setTimeout(() => router.refresh(), 0);
      after?.(r);
    });
  return { pending, error, run, setError };
}

/** Перестановка элемента в массиве. */
export function moveItem<T>(arr: T[], from: number, to: number) {
  const a = [...arr];
  const [x] = a.splice(from, 1);
  a.splice(to, 0, x);
  return a;
}
