"use client";
import { useFormStatus } from "react-dom";

/** Кнопка отправки формы: пока идёт запрос — неактивна. */
export function Submit({ children, className = "btn primary block", formAction }: { children: React.ReactNode; className?: string; formAction?: (f: FormData) => void }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={className} disabled={pending} formAction={formAction} aria-busy={pending}>
      {children}
    </button>
  );
}
