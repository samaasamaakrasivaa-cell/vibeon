import { notFound } from "next/navigation";
import { outbox } from "@/lib/mail";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

/** Только для разработки: письма, которые ушли бы пользователям, пока SMTP не настроен. */
export default function DevMail() {
  if (env.isProd) notFound();
  return (
    <main className="main">
      <div className="page">
        <h1 className="mb-2">Письма (разработка)</h1>
        <p className="hint mb-6">SMTP не настроен — письма не отправляются, а показываются здесь. На рабочем сервере эта страница недоступна.</p>
        {outbox.length === 0 && <div className="card">Писем пока нет.</div>}
        {outbox.map((m, i) => (
          <section key={i} className="card">
            <div className="small muted">{m.at.toLocaleString("ru-RU")} · {m.to}</div>
            <h3 className="mt-1 mb-3">{m.subject}</h3>
            <iframe title={m.subject} srcDoc={m.html} className="h-[460px] w-full rounded-xl border border-sep bg-white" />
          </section>
        ))}
      </div>
    </main>
  );
}
