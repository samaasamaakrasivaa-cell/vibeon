"use client";

import { useEffect, useState } from "react";
import { Dialog } from "../Dialog";
import { useT } from "@/lib/i18n/client";
import type { WordConfirmation } from "@/lib/student/save-personal-word";

type Selection = { taskId: string; query: string; sentence: string };
type Suggestion = { translation: string; example: string };
type SaveResult = { ok: false } | { ok: true; status: "added" | "existing" | "updated" } |
  { ok: true; status: "confirm"; existing: WordConfirmation; value: string };
const sentences = typeof Intl.Segmenter === "function" ? new Intl.Segmenter("en", { granularity: "sentence" }) : null;
const compact = (text: string) => text.replace(/\s+/g, " ").trim();

function getLessonSelection(): Selection | null {
  const selected = document.getSelection();
  if (!selected || selected.isCollapsed || selected.rangeCount !== 1) return null;
  const range = selected.getRangeAt(0);
  const paragraph = range.startContainer.parentElement?.closest(".tk-rich p");
  const container = paragraph?.closest<HTMLElement>("[data-lesson-context]");
  if (!paragraph || !container?.dataset.lessonContext || !paragraph.contains(range.endContainer)) return null;

  const query = compact(range.toString());
  if (!query || query.length > 80) return null;
  const before = range.cloneRange();
  before.selectNodeContents(paragraph);
  before.setEnd(range.startContainer, range.startOffset);
  const offset = before.toString().length;
  const plain = paragraph.textContent ?? "";
  for (const { segment, index } of sentences?.segment(plain) ?? [{ segment: plain, index: 0 }]) {
    if (offset < index || offset + range.toString().length > index + segment.length) continue;
    const sentence = compact(segment);
    if (sentence.length <= 320) return { taskId: container.dataset.lessonContext, query, sentence };
  }
  return null;
}

export function ClassContextDictionary({ lessonId, recipients, save }: {
  lessonId: string;
  recipients?: { id: string; name: string }[];
  save?: (selection: Selection, suggestion: Suggestion, studentId: string, confirmation?: WordConfirmation) => Promise<SaveResult>;
}) {
  const { t } = useT();
  const [selected, setSelected] = useState<Selection | null>(null);
  const [opened, setOpened] = useState<Selection | null>(null);
  const [studentId, setStudentId] = useState("");
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<"cls.dictUnavailable" | "cls.dictSaveFailed" | "cls.dictSavedContext" | null>(null);
  const [confirmation, setConfirmation] = useState<{ suggestion: Suggestion; existing: WordConfirmation } | null>(null);

  useEffect(() => {
    const update = () => setSelected(getLessonSelection());
    document.addEventListener("selectionchange", update);
    return () => document.removeEventListener("selectionchange", update);
  }, []);

  useEffect(() => {
    if (!opened) return;
    const controller = new AbortController();
    setLoading(true);
    setSuggestions([]);
    setNotice(null);
    setConfirmation(null);
    fetch(`/api/class/${encodeURIComponent(lessonId)}/context-dictionary`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(opened), signal: controller.signal,
    }).then(async (response) => {
      if (!response.ok) throw new Error("dictionary");
      const result: { suggestions: Suggestion[] } = await response.json();
      if (!controller.signal.aborted) setSuggestions(result.suggestions);
    }).catch(() => {
      if (!controller.signal.aborted) setNotice("cls.dictUnavailable");
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [lessonId, opened]);

  async function add(suggestion: Suggestion, expected?: WordConfirmation) {
    if (!save || !opened || saving || (recipients && !studentId)) return;
    setSaving(true);
    setConfirmation(null);
    setNotice(null);
    try {
      const result = await save(opened, suggestion, studentId, expected);
      if (!result.ok) setNotice("cls.dictSaveFailed");
      else if (result.status === "confirm") setConfirmation({ suggestion, existing: result.existing });
      else setNotice("cls.dictSavedContext");
    } catch {
      setNotice("cls.dictSaveFailed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      {selected && !opened && (
        <div className="sticky top-0 z-10 flex justify-center">
          <button type="button" className="btn primary sm" onPointerDown={(event) => event.preventDefault()}
            onClick={() => setOpened(selected)}>{t("cls.translateSelection")}</button>
        </div>
      )}
      {opened && (
        <Dialog open title={opened.query} onClose={() => { if (!saving) setOpened(null); }}>
          <p className="small"><b>{t("cls.contextOriginal")}</b> <span lang="en">{opened.sentence}</span></p>
          {recipients && (
            <label className="field">
              <span className="flabel">{t("cls.contextRecipient")}</span>
              <select className="select" value={studentId} disabled={saving} onChange={(event) => {
                setStudentId(event.target.value); setConfirmation(null); setNotice(null);
              }}>
                <option value="">{t("cls.contextRecipient")}</option>
                {recipients.map(({ id, name }) => <option key={id} value={id}>{name}</option>)}
              </select>
            </label>
          )}
          {loading && <p role="status">{t("cls.dictLoading")}</p>}
          {!loading && !notice && !suggestions.length && <p role="status">{t("cls.contextNoResult")}</p>}
          {notice && <p role="status">{t(notice)}</p>}
          <ul className="flex flex-col gap-2">
            {suggestions.map((suggestion) => (
              <li className="row" key={suggestion.translation}>
                <div>
                  <b>{suggestion.translation}</b>
                  <div className="small muted">{t("cls.contextExample")} <span lang="en">{suggestion.example}</span></div>
                </div>
                {save && <button type="button" className="btn secondary sm" disabled={saving || !!confirmation || (!!recipients && !studentId)}
                  aria-label={t("cls.dictAdd", { translation: suggestion.translation })} onClick={() => void add(suggestion)}>+</button>}
              </li>
            ))}
          </ul>
          {confirmation && (
            <div className="alert">
              <p>{t("wd.addTranslation", { word: opened.query, value: confirmation.suggestion.translation })}</p>
              <div className="actions">
                <button type="button" className="btn secondary" onClick={() => setConfirmation(null)}>{t("common.cancel")}</button>
                <button type="button" className="btn primary" onClick={() => void add(confirmation.suggestion, confirmation.existing)}>{t("wd.updateTranslation")}</button>
              </div>
            </div>
          )}
        </Dialog>
      )}
    </>
  );
}
