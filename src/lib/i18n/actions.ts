"use server";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { LANGS, type LangCode } from "./dict";
import { db } from "../db";
import { getSessionUser } from "../auth/session";

export async function setLang(lang: LangCode) {
  if (!(LANGS as readonly string[]).includes(lang)) return;
  (await cookies()).set("lang", lang, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
  const user = await getSessionUser();
  if (user) await db.user.update({ where: { id: user.id }, data: { lang: lang === "en" ? "EN" : "RU" } });
  revalidatePath("/", "layout");
}
