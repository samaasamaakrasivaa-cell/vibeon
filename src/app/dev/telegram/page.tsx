import { notFound } from "next/navigation";
import { tgMock, tgOutbox } from "@/lib/notify/telegram";
import { DevStart } from "./DevStart";

export const dynamic = "force-dynamic";

/** Только для разработки (TELEGRAM_MOCK=1): что бот отправил бы в Telegram, и кнопка «Start» вместо настоящего бота. */
export default async function DevTelegram({ searchParams }: { searchParams: Promise<{ start?: string }> }) {
  if (!tgMock()) notFound();
  const { start } = await searchParams;
  return (
    <main className="main">
      <div className="page" style={{ maxWidth: 760 }}>
        <h1 className="mb-2">Telegram (разработка)</h1>
        <p className="hint mb-6">Ключа бота нет — включён тестовый режим TELEGRAM_MOCK. Сообщения бота показываются здесь. Когда в .env появится TELEGRAM_BOT_TOKEN, всё пойдёт в настоящий Telegram.</p>
        {start && <DevStart code={start} />}
        <section className="card">
          <h3 className="mt-0">Сообщения бота</h3>
          {tgOutbox.length === 0 && <p className="hint m-0">Пока ничего.</p>}
          <div className="flex flex-col gap-2">
            {tgOutbox.map((m, i) => (
              <div key={i} className="tgmsg"><div className="small muted">чат {m.chatId} · {m.at.toLocaleString("ru-RU")}</div><div className="whitespace-pre-line">{m.text}</div>{m.url && <a className="small" href={m.url}>{m.url}</a>}</div>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
