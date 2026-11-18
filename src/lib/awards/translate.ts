import "server-only";
import { db } from "../db";
import { run } from "../ai/gateway";
import { provider } from "../ai/providers";

const busy = new Set<string>();
export const isRu = (s: string) => /[А-Яа-яЁё]/.test(s);

/** Свои статусы учителя без второго языка — переводим ИИ (в фоне; учитель потом может поправить). */
export async function translateTemplates(teacherId: string) {
  // без настоящего ИИ не переводим (заглушка испортила бы названия); AWARD_TR_MOCK=1 — только для проверок
  if (provider() === "mock" && process.env.AWARD_TR_MOCK !== "1") return;
    if (busy.has(teacherId)) return;
  busy.add(teacherId);
  try {
    const list = await db.awardTemplate.findMany({ where: { teacherId, OR: [{ nameRu: null }, { nameEn: null }] }, take: 40 });
    for (const to of ["ru", "en"] as const) {
      const need = list.filter((x) => (to === "ru" ? !x.nameRu : !x.nameEn));
      if (!need.length) continue;
      const src = need.map((x) => ({ name: (to === "ru" ? x.nameEn : x.nameRu) ?? x.name, why: (to === "ru" ? x.whyEn : x.whyRu) ?? x.why ?? "" }));
      const out = await run("awardtr", { to, items: src }, { userId: teacherId, teacherId });
      for (const [k, x] of need.entries()) {
        const r = out.items[k];
        if (!r?.name) continue;
        await db.awardTemplate.update({ where: { id: x.id }, data: to === "ru" ? { nameRu: r.name, whyRu: r.why || null } : { nameEn: r.name, whyEn: r.why || null } });
      }
    }
  } catch (e) {
    console.error("[awardtr]", (e as Error).message);
  } finally {
    busy.delete(teacherId);
  }
}
