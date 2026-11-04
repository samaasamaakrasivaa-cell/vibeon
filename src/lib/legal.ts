import "server-only";

/**
 * Реквизиты оператора персональных данных для юридических страниц.
 * Задаются на сервере (deploy/.env или секреты GitHub → action «secrets»):
 *   LEGAL_OPERATOR — «Самозанятая Иванова Мария Петровна» / «ИП Иванова М. П.»
 *   LEGAL_INN      — ИНН
 *   LEGAL_EMAIL    — почта для обращений по персональным данным
 */
export function legalInfo() {
  const domain = (process.env.APP_URL ?? "https://vibeon.online").replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  const fromMail = (process.env.MAIL_FROM ?? "").match(/[\w.+-]+@[\w.-]+/)?.[0];
  const replyable = fromMail && !/^no-?reply@/i.test(fromMail) ? fromMail : null; // на no-reply писать бессмысленно
  return {
    operator: process.env.LEGAL_OPERATOR?.trim() || null,
    inn: process.env.LEGAL_INN?.trim() || null,
    email: process.env.LEGAL_EMAIL?.trim() || replyable || `support@${domain}`,
    site: domain,
    updated: process.env.LEGAL_UPDATED?.trim() || "4 ноября 2026 г.",
  };
}
