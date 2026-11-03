import "server-only";

export const env = {
  appUrl: (process.env.APP_URL || "http://localhost:3000").replace(/\/$/, ""),
  isProd: process.env.NODE_ENV === "production",
  trialDays: Number(process.env.TRIAL_DAYS || 14),
  smtp: {
    host: process.env.SMTP_HOST || "",
    port: Number(process.env.SMTP_PORT || 587),
    user: process.env.SMTP_USER || "",
    pass: process.env.SMTP_PASS || "",
    from: process.env.MAIL_FROM || "VibeOn <no-reply@vibeon.ru>",
  },
  yandex: { id: process.env.YANDEX_CLIENT_ID || "", secret: process.env.YANDEX_CLIENT_SECRET || "" },
  vk: { id: process.env.VK_CLIENT_ID || "", secret: process.env.VK_CLIENT_SECRET || "" },
  telegramBot: process.env.TELEGRAM_BOT_TOKEN || "",
};

export const oauthEnabled = {
  yandex: !!(env.yandex.id && env.yandex.secret),
  vk: !!env.vk.id,
};

/** Куки помечаются Secure, когда сайт работает по HTTPS. */
export const secureCookies = env.appUrl.startsWith("https://");
