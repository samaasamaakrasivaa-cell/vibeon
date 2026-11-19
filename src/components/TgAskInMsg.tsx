"use client";
import { useT } from "@/lib/i18n/client";
import { isTgAsk } from "@/lib/notify/tg-ask";
import { TgConnect } from "./TgConnect";

/** Под сообщением учителя «подключите Telegram-бот» — кнопка для ученика; подключил — отметка. */
export function TgAskInMsg({ text, mine, linked }: { text: string; mine: boolean; linked?: boolean | null }) {
  const { t } = useT();
  if (mine || linked === undefined || linked === null || !isTgAsk(text)) return null;
  return <span className="bubble-act" onClick={(e) => e.stopPropagation()}>{linked ? <span className="small text-ok">✓ {t("tg.linkedMsg")}</span> : <TgConnect compact />}</span>;
}
