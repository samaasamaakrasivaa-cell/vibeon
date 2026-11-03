import { getT } from "@/lib/i18n/server";
import type { DictKey } from "@/lib/i18n/dict";
import { Icon } from "./Icon";
import type { IconName } from "./icon-paths";

export async function Soon({ titleKey, stage, icon }: { titleKey: DictKey; stage: number; icon: IconName }) {
  const { t } = await getT();
  return (
    <div className="page">
      <h1 className="mb-6">{t(titleKey)}</h1>
      <div className="card flex flex-col items-center gap-3 py-14 text-center">
        <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-accent-bg text-accent">
          <Icon name={icon} size="lg" />
        </span>
        <h3>{t("common.soonTitle")}</h3>
        <p className="hint m-0">{t("common.soon", { n: stage })}</p>
      </div>
    </div>
  );
}
