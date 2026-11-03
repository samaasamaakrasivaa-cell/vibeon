import "server-only";
import { cookies } from "next/headers";
import { LANGS, translate, type DictKey, type LangCode } from "./dict";

export const LANG_COOKIE = "lang";

export async function getLang(): Promise<LangCode> {
  const v = (await cookies()).get(LANG_COOKIE)?.value;
  return (LANGS as readonly string[]).includes(v ?? "") ? (v as LangCode) : "ru";
}

export async function getT() {
  const lang = await getLang();
  return {
    lang,
    t: (key: DictKey, vars?: Record<string, string | number>) => translate(lang, key, vars),
  };
}
