"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useT } from "@/lib/i18n/client";
import { linkTelegram } from "@/lib/notify/actions";
import { Icon } from "./Icon";

/** «Подключить Telegram»: открывает бота с одноразовым кодом; после «Старт» аккаунт привязывается сам. */
export function TgConnect() {
  const { t } = useT();
  const router = useRouter();
  const [opened, setOpened] = useState(false);
  const [pending, start] = useTransition();
  return (
    <>
      <button className="btn primary lg w-full" disabled={pending} onClick={() => start(async () => { const r = await linkTelegram(); if (r.ok && r.url) { window.open(r.url, "_blank"); setOpened(true); } })}>
        <Icon name="telegram" />{t("tg.connect")}
      </button>
      {opened && <button className="btn secondary w-full" onClick={() => router.refresh()}>{t("nf.refresh")}</button>}
    </>
  );
}
