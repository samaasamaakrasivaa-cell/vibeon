"use client";
import { useTransition } from "react";
import { hideFirstSteps } from "@/lib/teacher/actions";
import { useT } from "@/lib/i18n/client";
import { Icon } from "../Icon";

/** Крестик у блока «С чего начать»: скрывает его насовсем. */
export function HideSteps() {
  const { t } = useT();
  const [pending, start] = useTransition();
  return (
    <button type="button" className="iconbtn" disabled={pending} aria-label={t("fs.hide")} title={t("fs.hide")} onClick={() => start(async () => { await hideFirstSteps(); })}>
      <Icon name="close" size="sm" />
    </button>
  );
}
