"use client";

import { useEffect, useRef, useState } from "react";
import { useT } from "@/lib/i18n/client";
import type { WordConfirmation } from "@/lib/student/save-personal-word";
import { wordTranslations } from "@/lib/student/word-translations";
import { Dialog } from "../Dialog";
import { Icon } from "../Icon";

type Lookup = { translations: string[] } | { error: string };
type SavedWord =
  | { ok: true; status: "added" | "updated" | "existing"; translation: string | null }
  | { ok: true; status: "confirm"; existing: WordConfirmation & { word: string }; value: string }
  | { ok: false };
type Props = {
  lessonId: string;
  preview: boolean;
  canSave: boolean;
  recipient?: string;
  save: (word: string, translation: string, confirmation?: WordConfirmation) => Promise<SavedWord>;
};

export function ClassDictionary({ lessonId, preview, canSave, recipient, save }: Props) {
  const { t } = useT();
  const [query, setQuery] = useState("");
  const [lookup, setLookup] = useState<Lookup | null>(null);
  const [loading, setLoading] = useState(false);
  const [manual, setManual] = useState(false);
  const [translation, setTranslation] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<SavedWord | null>(null);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);

  const word = query.trim();
  const confirmation = saved?.ok && saved.status === "confirm" ? saved : null;
  const success = saved?.ok && (saved.status === "added" || saved.status === "updated") ? saved : null;
  const current = wordTranslations(confirmation?.existing.translation ?? null).join("; ");
  const options = lookup && "translations" in lookup ? lookup.translations : [];
  const lookupMessage = lookup && "error" in lookup
    ? t(lookup.error === "input" ? "cls.dictInput" : lookup.error === "limit" ? "cls.dictLimit" : "cls.dictUnavailable")
    : lookup && !options.length ? t("cls.dictEmpty") : null;

  const search = async () => {
    if (!word || preview || loading || saving) return;
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    setLookup(null);
    setSaved(null);
    try {
      const response = await fetch(`/api/class/${encodeURIComponent(lessonId)}/dictionary`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: word }),
        signal: controller.signal,
      });
      const result: Lookup = await response.json();
      if (!controller.signal.aborted) setLookup(result);
    } catch {
      if (!controller.signal.aborted) setLookup({ error: "unavailable" });
    } finally {
      if (request.current === controller) {
        request.current = null;
        setLoading(false);
      }
    }
  };

  const add = async (candidate: string, expected?: WordConfirmation) => {
    if (!word || !candidate.trim() || preview || !canSave || saving || success) return;
    setSaving(true);
    setSaved(null);
    try {
      setSaved(await save(word, candidate.trim(), expected));
    } catch {
      setSaved({ ok: false });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <h3 className="mb-2">{t("cls.dict")}</h3>
      <form className="flex flex-wrap gap-2" onSubmit={(event) => { event.preventDefault(); void search(); }}>
        <input className="input grow min-w-0" value={query} maxLength={120} autoFocus
          aria-label={t("cls.dictPh")} placeholder={t("cls.dictPh")} disabled={saving}
          onChange={(event) => {
            request.current?.abort();
            request.current = null;
            setLoading(false);
            setQuery(event.target.value);
            setLookup(null);
            setTranslation("");
            setSaved(null);
          }} />
        <button type="submit" className="btn primary sm" disabled={!word || preview || loading || saving}>{t("cls.dictSearch")}</button>
      </form>
      {recipient && <p className="hint mt-2">{t("cls.dictRecipient", { name: recipient })}</p>}
      <div role="status" className="small mt-2">
        {loading && t("cls.dictLoading")}
        {lookupMessage}
        {success && <span className="text-ok">{t(success.status === "updated" ? "cls.dictUpdated" : "cls.dictSaved", { word, translation: wordTranslations(success.translation).join("; ") || "—" })}</span>}
        {saved?.ok && saved.status === "existing" && <span>{t("wd.wordExists")}</span>}
        {saved && !saved.ok && <span className="text-bad">{t("cls.dictSaveFailed")}</span>}
      </div>
      {confirmation && (
        <Dialog open title={t("wd.updateTranslation")} onClose={() => { if (!saving) setSaved(null); }}>
          <p className="m-0 break-words">{t("wd.addTranslation", { word: confirmation.existing.word, value: confirmation.value })}</p>
          {current && <p className="small muted mt-2 mb-0 break-words">{t("wd.currentTranslation", { value: current })}</p>}
          <div className="actions">
            <button type="button" className="btn secondary" disabled={saving} onClick={() => setSaved(null)}>{t("common.cancel")}</button>
            <button type="button" className="btn primary" disabled={saving}
              onClick={() => void add(confirmation.value, { id: confirmation.existing.id, translation: confirmation.existing.translation })}>
              {t("wd.updateTranslation")}
            </button>
          </div>
        </Dialog>
      )}
      {options.length > 0 && (
        <ul className="mt-2 flex flex-col gap-2">
          {options.map((option) => (
            <li key={option} className="flex items-center justify-between gap-2">
              <span><b>{word}</b> — {option}</span>
              {canSave && !preview && (
                <button type="button" className="iconbtn wplus" disabled={saving || !!success}
                  aria-label={t("cls.dictAdd", { translation: option })} onClick={() => void add(option)}>
                  <Icon name="plus" size="sm" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {word && (
        <div className="mt-3 flex flex-col gap-2">
          {canSave && !preview && !success && (
            <>
              <button type="button" className="btn plain sm self-start" aria-expanded={manual} onClick={() => setManual(!manual)}>{t("cls.dictManual")}</button>
              {manual && (
                <form className="flex flex-wrap gap-2" onSubmit={(event) => { event.preventDefault(); void add(translation); }}>
                  <input className="input grow min-w-0" maxLength={200} value={translation} disabled={saving} lang="ru"
                    aria-label={t("cls.dictTranslation")} placeholder={t("cls.dictTranslation")} onChange={(event) => setTranslation(event.target.value)} />
                  <button type="submit" className="btn primary sm" disabled={!translation.trim() || saving}>{t("cls.addWord")}</button>
                </form>
              )}
            </>
          )}
          <div className="flex flex-wrap gap-2">
            <a className="btn secondary sm" target="_blank" rel="noreferrer" href={`https://dictionary.cambridge.org/dictionary/english-russian/${encodeURIComponent(word)}`}>Cambridge ↗</a>
            <a className="btn secondary sm" target="_blank" rel="noreferrer" href={`https://www.multitran.com/m.exe?l1=1&l2=2&s=${encodeURIComponent(word)}`}>Multitran ↗</a>
          </div>
        </div>
      )}
    </div>
  );
}
