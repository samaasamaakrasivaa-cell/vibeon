import Link from "next/link";
import { LogoMark } from "@/components/Logo";

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
      <LogoMark size={56} />
      <h1>404</h1>
      <p className="muted m-0">Страница не найдена · Page not found</p>
      <Link href="/" className="btn primary">VibeOn</Link>
    </main>
  );
}
