import { AuthShell } from "@/components/auth/AuthShell";

export const metadata = { title: "Условия использования" };

// Текст документа готовит оператор персональных данных (этап 11, «Решения и доступы», раздел 6).
export default function Page() {
  return (
    <AuthShell wordmark={false}>
      <section className="authcard wide">
        <h1>Условия использования</h1>
        <p className="hint mt-4 mb-0">Текст документа будет опубликован до запуска платформы.</p>
      </section>
    </AuthShell>
  );
}
