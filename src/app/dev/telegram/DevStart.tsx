"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

/** Имитация нажатия «Start» в Telegram: тот же запрос, что прислал бы Telegram на вебхук. */
export function DevStart({ code }: { code: string }) {
  const router = useRouter();
  const [done, setDone] = useState(false);
  const chat = 100000 + [...code].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 900000, 7);
  return (
    <section className="card">
      <h3 className="mt-0">@vibeon_dev_bot</h3>
      <p className="muted">Так выглядит переход по ссылке «Подключить Telegram». В настоящем Telegram здесь кнопка «Запустить».</p>
      <button className="btn primary" disabled={done} onClick={async () => {
        await fetch("/api/telegram/webhook", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ update_id: Date.now(), message: { chat: { id: chat }, text: `/start ${code}` } }) });
        setDone(true); router.refresh();
      }}>{done ? "Запущено ✓" : "Start"}</button>
    </section>
  );
}
