"use client";
import { useT } from "@/lib/i18n/client";

type Props = { enabled: { yandex: boolean; vk: boolean }; intent?: "login" | "signup"; consent?: boolean };

/** Кнопки Яндекс ID и VK ID — только подключённые (заданы ключи); при регистрации неактивны, пока нет согласия на ПД. */
export function OAuthButtons({ enabled, intent = "login", consent = true }: Props) {
  const { t } = useT();
  const item = (p: "yandex" | "vk", label: string, badge: React.ReactNode) => {
    const on = enabled[p] && consent;
    const title = !enabled[p] ? t("auth.oauthOff", { p: label }) : !consent ? t("auth.err.consent") : undefined;
    return (
      <a
        href={on ? `/api/auth/${p}?intent=${intent}${intent === "signup" ? "&consent=1" : ""}` : undefined}
        className="oauthbtn"
        aria-disabled={!on}
        title={title}
        onClick={(e) => !on && e.preventDefault()}
      >
        {badge}
        {label}
      </a>
    );
  };
  return (
    <div className="oauthrow">
      {enabled.yandex && item("yandex", t("auth.yandex"), <span className="ya">Я</span>)}
      {enabled.vk && item("vk", t("auth.vk"), <span className="vk">VK</span>)}
    </div>
  );
}
