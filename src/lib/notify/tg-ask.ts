// Сообщение учителя «подключите Telegram-бот» — у ученика в чате под ним кнопка «Подключить Telegram»
export const isTgAsk = (text: string) => /Telegram-бот VibeOn/.test(text);
