import { getT } from "@/lib/i18n/server";
import type { AccessState } from "@/lib/admin/features";

/** Кабинет учителя: напоминание о сроке доступа — за 5 дней до конца пробного/оплаченного и после. Пока ничего не блокирует. */
export async function TrialBanner({ state, until }: { state: AccessState; until: string | null }) {
  const { t, lang } = await getT();
  const left = until ? Math.ceil((new Date(until).getTime() - Date.now()) / 864e5) : 0;
  const d = until ? new Date(until).toLocaleDateString(lang === "en" ? "en-GB" : "ru-RU", { day: "numeric", month: "long" }) : "";
  if (state === "blocked") return <div className="alert trialbar bad">{t("acc.blocked")}</div>;
  if (state === "expired") return <div className="alert trialbar bad">{t("acc.expired", { d })}</div>;
  if (left > 5) return null;
  return <div className="alert trialbar">{state === "trial" ? t("acc.trialLeft", { d, n: left }) : t("acc.paidLeft", { d, n: left })}</div>;
}
