"use client";

import { useState } from "react";
import { useT } from "@/lib/i18n/client";
import type { WordConfirmation } from "@/lib/student/save-personal-word";
import { wordTranslations } from "@/lib/student/word-translations";
import type { SavedWord } from "./ClassDictionary";

export type LessonWord = { word: string; tr: string; ex: string };
type Confirmation = Extract<SavedWord, { status: "confirm" }>;
const wordKey = (word: LessonWord) => JSON.stringify([word.word, word.tr]);

export function LessonWordPicker({ words, save, close }: {
  words: LessonWord[];
  save: (word: LessonWord, confirmation?: WordConfirmation) => Promise<SavedWord>;
  close: () => void;
}) {
  const { t } = useT();
  const [selected, setSelected] = useState<string[]>([]);
  const [pending, setPending] = useState<LessonWord[]>([]);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [saved, setSaved] = useState(false);

  async function process(words: LessonWord[], expected?: WordConfirmation) {
    setBusy(true);
    setConfirmation(null);
    for (const [index, word] of words.entries()) {
      const result = await save(word, index === 0 ? expected : undefined).catch(() => ({ ok: false } as const));
      if (!result.ok) {
        setFailed(true);
      } else if (result.status === "confirm") {
        setPending(words.slice(index));
        setConfirmation(result);
        setBusy(false);
        return;
      } else {
        setSelected((current) => current.filter((key) => key !== wordKey(word)));
        setSaved(true);
      }
    }
    setPending([]);
    setBusy(false);
  }

  const current = wordTranslations(confirmation?.existing.translation ?? null).join("; ");
  const checkedWords = words.filter((word) => selected.includes(wordKey(word)));
  return (
    <section className="mb-5" aria-label={t("cls.chooseLessonWords")}>
      <h2>{t("cls.chooseLessonWords")}</h2>
      <fieldset className="list" disabled={busy || !!confirmation}>
        {words.map((word) => (
          <label className="row flex items-center gap-3" key={wordKey(word)}>
            <input type="checkbox" checked={selected.includes(wordKey(word))}
              onChange={(event) => {
                const checked = event.target.checked;
                setSaved(false);
                setSelected((current) => checked ? [...current, wordKey(word)] : current.filter((key) => key !== wordKey(word)));
              }} />
            <span><b>{word.word}</b> — {word.tr}</span>
          </label>
        ))}
      </fieldset>
      {confirmation && (
        <div className="alert mt-3">
          <p>{t("wd.addTranslation", { word: confirmation.existing.word, value: confirmation.value })}</p>
          {current && <p>{t("wd.currentTranslation", { value: current })}</p>}
          <div className="flex gap-2">
            <button type="button" className="btn secondary" onClick={() => {
              setSelected((items) => items.filter((key) => key !== wordKey(pending[0])));
              void process(pending.slice(1));
            }}>{t("cls.skipLessonWord")}</button>
            <button type="button" className="btn primary" onClick={() => void process(pending, confirmation.existing)}>
              {t("wd.updateTranslation")}
            </button>
          </div>
        </div>
      )}
      {failed && <p role="alert">{t("cls.lessonWordsSaveFailed")}</p>}
      {saved && !busy && !confirmation && !failed && <p role="status">{t("common.saved")}</p>}
      <div className="flex gap-2 mt-3">
        <button type="button" className="btn secondary" disabled={busy} onClick={close}>{t(saved || confirmation ? "common.close" : "common.cancel")}</button>
        {!confirmation && (
          <button type="button" className="btn primary" disabled={busy || !checkedWords.length} onClick={() => {
            setFailed(false);
            setSaved(false);
            void process(checkedWords);
          }}>{t("cls.saveLessonWords")}</button>
        )}
      </div>
    </section>
  );
}
