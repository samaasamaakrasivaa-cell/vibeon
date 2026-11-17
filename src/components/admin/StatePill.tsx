import { getT } from "@/lib/i18n/server";
import type { AccessState } from "@/lib/admin/features";

const COLOR: Record<AccessState, string> = { trial: "orange", paid: "green", expired: "grey", blocked: "red" };

export async function StatePill({ state }: { state: AccessState }) {
  const { t } = await getT();
  return <span className={`pill ${COLOR[state]}`}>{t(`adm.f.${state}` as "adm.f.trial")}</span>;
}
