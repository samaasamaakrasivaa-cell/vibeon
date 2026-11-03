import { LogoMark } from "@/components/Logo";

/** Экран загрузки: появляется только если загрузка дольше ~0,5 с (задержка в CSS .loader). */
export default function Loading() {
  return (
    <div className="loader" role="status" aria-label="Loading">
      <LogoMark size={64} animated />
    </div>
  );
}
