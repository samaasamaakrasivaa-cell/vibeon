import "server-only";
import nodemailer from "nodemailer";
import { env } from "./env";

type Mail = { to: string; subject: string; html: string; text: string; at: Date };

/** Журнал писем для разработки (страница /dev/mail), когда SMTP не настроен. */
const g = globalThis as unknown as { __outbox?: Mail[] };
export const outbox = (g.__outbox ??= []);

let transport: nodemailer.Transporter | null = null;
function getTransport() {
  if (!env.smtp.host) return null;
  transport ??= nodemailer.createTransport({
    host: env.smtp.host,
    port: env.smtp.port,
    secure: env.smtp.port === 465,
    auth: env.smtp.user ? { user: env.smtp.user, pass: env.smtp.pass } : undefined,
  });
  return transport;
}

export async function sendMail(to: string, subject: string, html: string, text: string) {
  const t = getTransport();
  if (!t) {
    outbox.unshift({ to, subject, html, text, at: new Date() });
    outbox.splice(50);
    console.log(`[mail] SMTP не настроен — письмо не отправлено.\n  Кому: ${to}\n  Тема: ${subject}\n  ${text.replace(/\n/g, "\n  ")}`);
    return;
  }
  await t.sendMail({ from: env.smtp.from, to, subject, html, text });
}

/** Отправить и не уронить страницу: false — письмо не ушло (причина в журнале сервера). */
async function soft(to: string, subject: string, html: string, text: string) {
  try { await sendMail(to, subject, html, text); return true; }
  catch (e) { console.error(`[mail] не отправлено (${subject}):`, (e as Error).message); return false; }
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** Единый вид письма: логотип, заголовок, текст, синяя кнопка. */
function layout(title: string, body: string, button: { label: string; url: string }, foot: string) {
  const html = `<!doctype html><html><body style="margin:0;background:#F2F2F7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#1C1C1E">
<table width="100%" cellpadding="0" cellspacing="0" style="padding:32px 12px"><tr><td align="center">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#fff;border-radius:20px;padding:32px">
<tr><td align="center" style="padding-bottom:16px"><div style="width:48px;height:48px;border-radius:13px;background:linear-gradient(135deg,#FF6B9A,#A55CF5,#3D8BFF);color:#fff;font-weight:800;font-size:24px;line-height:48px">V</div></td></tr>
<tr><td align="center" style="font-size:22px;font-weight:700;padding-bottom:12px">${esc(title)}</td></tr>
<tr><td align="center" style="font-size:15px;line-height:1.5;color:#3A3A3C;padding-bottom:24px">${body}</td></tr>
<tr><td align="center" style="padding-bottom:24px"><a href="${esc(button.url)}" style="display:inline-block;background:#007AFF;color:#fff;text-decoration:none;font-weight:600;font-size:16px;padding:14px 28px;border-radius:24px">${esc(button.label)}</a></td></tr>
<tr><td align="center" style="font-size:12px;color:#8E8E93;line-height:1.5;padding-bottom:16px">Если кнопка не нажимается, скопируйте ссылку в браузер:<br><a href="${esc(button.url)}" style="color:#007AFF;word-break:break-all">${esc(button.url)}</a></td></tr>
<tr><td align="center" style="font-size:12px;color:#8E8E93;line-height:1.5">${foot}</td></tr>
</table><div style="font-size:12px;color:#8E8E93;padding-top:16px">VibeOn</div></td></tr></table></body></html>`;
  const text = `${title}\n\n${body.replace(/<[^>]+>/g, "")}\n\n${button.label}: ${button.url}\n\n${foot.replace(/<[^>]+>/g, "")}`;
  return { html, text };
}

type L = "ru" | "en";

export async function mailVerify(to: string, name: string, url: string, lang: L) {
  const m =
    lang === "en"
      ? layout(`${name}, confirm your email`, "One click — and you are in your VibeOn workspace.", { label: "Confirm email", url }, "The link is valid for 24 hours. If you didn’t sign up for VibeOn, just ignore this email.")
      : layout(`${esc(name)}, подтвердите почту`, "Один клик — и вы в своём кабинете VibeOn.", { label: "Подтвердить почту", url }, "Ссылка действует 24 часа. Если вы не регистрировались в VibeOn, просто удалите это письмо.");
  return soft(to, lang === "en" ? "Confirm your email — VibeOn" : "Подтвердите почту — VibeOn", m.html, m.text);
}

export async function mailMagic(to: string, url: string, lang: L) {
  const m =
    lang === "en"
      ? layout("Sign in to VibeOn", "Press the button to sign in without a password.", { label: "Sign in", url }, "The link is valid for 15 minutes. If you didn’t request it, ignore this email.")
      : layout("Вход в VibeOn", "Нажмите кнопку, чтобы войти без пароля.", { label: "Войти", url }, "Ссылка действует 15 минут. Если вы не запрашивали вход, просто удалите это письмо.");
  return soft(to, lang === "en" ? "Sign-in link — VibeOn" : "Ссылка для входа — VibeOn", m.html, m.text);
}

export async function mailReset(to: string, url: string, lang: L) {
  const m =
    lang === "en"
      ? layout("Reset your password", "Press the button and set a new password.", { label: "Set a new password", url }, "The link is valid for 1 hour and works once. If you didn’t request it, your password stays the same.")
      : layout("Новый пароль", "Нажмите кнопку и придумайте новый пароль.", { label: "Задать новый пароль", url }, "Ссылка действует 1 час и срабатывает один раз. Если вы не запрашивали сброс, пароль останется прежним.");
  return soft(to, lang === "en" ? "Password reset — VibeOn" : "Сброс пароля — VibeOn", m.html, m.text);
}

export async function mailInvite(to: string, studentName: string, teacherName: string, url: string, lang: L) {
  const m =
    lang === "en"
      ? layout(`${studentName}, your teacher is waiting`, `<b>${esc(teacherName)}</b> invites you to study English on VibeOn. Fill in a short form — it takes a couple of minutes.`, { label: "Fill in the form", url }, "The invitation is valid for 14 days.")
      : layout(`${esc(studentName)}, вас ждёт преподаватель`, `<b>${esc(teacherName)}</b> приглашает вас заниматься английским на VibeOn. Заполните короткую анкету — это займёт пару минут.`, { label: "Заполнить анкету", url }, "Приглашение действует 14 дней.");
  return soft(to, lang === "en" ? `${teacherName} invites you to VibeOn` : `${teacherName} приглашает вас в VibeOn`, m.html, m.text);
}

/** Счёт плательщику (родителю и т. п.), если в анкете указана его почта. */
export async function mailInvoice(to: string, payer: string, student: string, title: string, amount: string, url: string, reminder: boolean) {
  const m = layout(
    reminder ? `Напоминание об оплате: ${amount}` : `Счёт на оплату: ${amount}`,
    `${payer ? esc(payer) + ", " : ""}${reminder ? "напоминаем о счёте" : "выставлен счёт"} за занятия английским: <b>${esc(student)}</b>${title ? ` — ${esc(title)}` : ""}.`,
    { label: "Открыть VibeOn", url },
    "Реквизиты для оплаты — в счёте у ученика. После оплаты пришлите скриншот или напишите, с какого банка и когда была оплата.",
  );
  return soft(to, reminder ? `Напоминание об оплате — ${amount}` : `Счёт на оплату — ${amount}`, m.html, m.text);
}

/** Уведомление платформы на почту (по настройкам пользователя). */
export async function mailNotice(to: string, title: string, url: string, settingsUrl: string, lang: L) {
  const m = lang === "en"
    ? layout(title, "There is news in your VibeOn workspace.", { label: "Open VibeOn", url }, `You can choose which emails you get in <a href="${esc(settingsUrl)}">notification settings</a>.`)
    : layout(esc(title), "В вашем кабинете VibeOn есть новости.", { label: "Открыть VibeOn", url }, `Какие письма приходят, можно выбрать в <a href="${esc(settingsUrl)}">настройках уведомлений</a>.`);
  await sendMail(to, `${title} — VibeOn`, m.html, m.text);
}
