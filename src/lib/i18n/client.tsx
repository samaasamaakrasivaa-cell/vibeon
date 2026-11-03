"use client";
import { createContext, useContext } from "react";
import { translate, type DictKey, type LangCode } from "./dict";

const Ctx = createContext<LangCode>("ru");

export function I18nProvider({ lang, children }: { lang: LangCode; children: React.ReactNode }) {
  return <Ctx.Provider value={lang}>{children}</Ctx.Provider>;
}

export function useT() {
  const lang = useContext(Ctx);
  return { lang, t: (k: DictKey, v?: Record<string, string | number>) => translate(lang, k, v) };
}
