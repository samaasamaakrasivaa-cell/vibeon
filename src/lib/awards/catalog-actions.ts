"use server";
import { revalidatePath } from "next/cache";
import { db } from "../db";
import { requireUser } from "../auth/session";
import { isOwner } from "../placement/bank";
import { CATALOG, GROUPS, ICONS, METALS } from "./catalog";

// Каталог статусов правит только владелец платформы (OWNER_EMAIL) — как банк вводного теста.
type R = { ok: true; key?: string } | { ok: false; error: string };

async function owner() {
  const me = await requireUser("TEACHER");
  if (!isOwner(me.email)) throw new Error("owner");
  return me;
}
const done = () => { revalidatePath("/teacher/awards"); revalidatePath("/teacher/students", "layout"); revalidatePath("/class", "layout"); };

export type CatalogInput = {
  key: string | null; kind: "title" | "cheer"; group: string; nameRu: string; nameRuM: string; nameEn: string; whyRu: string; whyEn: string;
  icon: string; color: string; term: "week" | "month" | "forever"; hidden: boolean;
};

export async function saveCatalogItem(x: CatalogInput): Promise<R> {
  await owner();
  const nameRu = x.nameRu.trim().slice(0, 80);
  if (!nameRu) return { ok: false, error: "name" };
  if (!(x.icon in ICONS) || !(x.color in METALS)) return { ok: false, error: "style" };
  const kind = x.kind === "cheer" ? "cheer" : "title";
  const group = GROUPS.some((g) => g.key === x.group && g.kind === kind) ? x.group : GROUPS.find((g) => g.kind === kind)!.key;
  const builtin = !!x.key && CATALOG.some((c) => c.key === x.key);
  const key = x.key ?? `c_${Date.now().toString(36)}`;
  const data = {
    kind, group, nameRu, nameRuM: x.nameRuM.trim().slice(0, 80) || null, nameEn: x.nameEn.trim().slice(0, 80) || nameRu,
    whyRu: x.whyRu.trim().slice(0, 500), whyEn: x.whyEn.trim().slice(0, 500), icon: x.icon, color: x.color,
    term: kind === "title" && ["week", "month", "forever"].includes(x.term) ? x.term : "forever", hidden: x.hidden,
  };
  await db.awardCatalogItem.upsert({ where: { key }, create: { key, ...data, custom: !builtin }, update: data });
  done();
  return { ok: true, key };
}

/** Встроенный статус — вернуть как было (убрать правки); новый — удалить совсем. Выданные ученикам статусы не меняются. */
export async function resetCatalogItem(key: string): Promise<R> {
  await owner();
  await db.awardCatalogItem.deleteMany({ where: { key } });
  done();
  return { ok: true };
}
