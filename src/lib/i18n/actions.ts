"use server";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { LANGS, type LangCode } from "./dict";

export async function setLang(lang: LangCode) {
  if (!(LANGS as readonly string[]).includes(lang)) return;
  (await cookies()).set("lang", lang, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
  // Этап 2: дополнительно сохранять выбор в профиле пользователя (User.lang).
  revalidatePath("/", "layout");
}
