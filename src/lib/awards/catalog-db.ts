import "server-only";
import { db } from "../db";
import { CATALOG, GROUPS, ICONS, METALS, type CatalogItem, type IconKey, type Metal, type Term } from "./catalog";

type Row = Awaited<ReturnType<typeof db.awardCatalogItem.findMany>>[number];

const toItem = (r: Row): CatalogItem => ({
  key: r.key, kind: r.kind === "cheer" ? "cheer" : "title", group: r.group,
  name: { ru: r.nameRuM ? { f: r.nameRu, m: r.nameRuM } : r.nameRu, en: r.nameEn }, why: { ru: r.whyRu, en: r.whyEn },
  icon: (r.icon in ICONS ? r.icon : "star") as IconKey, color: (r.color in METALS ? r.color : "gold") as Metal,
  term: (["week", "month", "forever"].includes(r.term) ? r.term : "forever") as Term,
});

/** Каталог статусов для учителей: встроенный + правки владельца (по ключу) + новые статусы; скрытые — убраны. */
export async function getCatalog(opts: { withHidden?: boolean } = {}): Promise<(CatalogItem & { hidden?: boolean; edited?: boolean; custom?: boolean })[]> {
  const rows = await db.awardCatalogItem.findMany({ orderBy: { updatedAt: "asc" } });
  const by = new Map(rows.map((r) => [r.key, r]));
  const out: (CatalogItem & { hidden?: boolean; edited?: boolean; custom?: boolean })[] = CATALOG.map((c) => {
    const r = by.get(c.key);
    return r ? { ...toItem(r), hidden: r.hidden, edited: true } : c;
  });
  // новые — в конце своей группы
  for (const r of rows.filter((x) => x.custom)) {
    const item = { ...toItem(r), hidden: r.hidden, custom: true };
    const last = out.map((x) => x.group).lastIndexOf(r.group);
    out.splice(last >= 0 ? last + 1 : out.length, 0, item);
  }
  return opts.withHidden ? out : out.filter((x) => !x.hidden);
}

export const GROUP_KEYS = GROUPS.map((g) => g.key);
