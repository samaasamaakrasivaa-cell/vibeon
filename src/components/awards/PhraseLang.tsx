"use client";
import { useEffect, useState } from "react";
import { useT } from "@/lib/i18n/client";

export type PL = "ru" | "en";
const KEY = "vb.awLang";

/** Язык фраз статусов — отдельно от языка интерфейса; последний выбор учителя запоминаем на этом устройстве. */
export function usePhraseLang(): [PL, (v: PL) => void] {
  const { lang } = useT();
  const [pl, setPl] = useState<PL>(lang === "en" ? "en" : "ru");
  useEffect(() => { try { const v = localStorage.getItem(KEY); if (v === "ru" || v === "en") setPl(v); } catch { /* нет хранилища — по языку интерфейса */ } }, []);
  return [pl, (v) => { setPl(v); try { localStorage.setItem(KEY, v); } catch { /* ок */ } }];
}

/** Бегунок «Рус / Eng»: на каком языке выдаём статус. */
export function PhraseLangSwitch({ value, onChange }: { value: PL; onChange: (v: PL) => void }) {
  const { t } = useT();
  return (
    <div className="awlang" role="group" aria-label={t("aw.phraseLang")}>
      <span className="small muted">{t("aw.phraseLang")}</span>
      <div className="seg">
        <button type="button" aria-pressed={value === "ru"} onClick={() => onChange("ru")}>Рус</button>
        <button type="button" aria-pressed={value === "en"} onClick={() => onChange("en")}>Eng</button>
      </div>
    </div>
  );
}
