"use client";
import { ErrorView } from "@/components/ErrorView";

/** Ошибка во всём приложении (в том числе в общей разметке). */
export default function GlobalError(props: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="ru">
      <body style={{ margin: 0, background: "#F2F2F7" }}>
        <ErrorView {...props} />
      </body>
    </html>
  );
}
