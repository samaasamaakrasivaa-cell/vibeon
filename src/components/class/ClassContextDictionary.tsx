"use client";

import { useEffect, useState } from "react";
import { Dialog } from "../Dialog";
import { useT } from "@/lib/i18n/client";
type Selection = { taskId: string; query: string; sentence: string };
type Suggestion = { translation: string; example: string };
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

export function ClassContextDictionary({ lessonId }: { lessonId: string }) {
  const { t } = useT();
  const [selected, setSelected] = useState<Selection | null>(null);
  const [opened, setOpened] = useState<Selection | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

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
    setError(false);
    fetch(`/api/class/${encodeURIComponent(lessonId)}/context-dictionary`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(opened), signal: controller.signal,
    }).then(async (response) => {
      if (!response.ok) throw new Error("dictionary");
      const result: { suggestions: Suggestion[] } = await response.json();
      if (!controller.signal.aborted) setSuggestions(result.suggestions);
    }).catch(() => {
      if (!controller.signal.aborted) setError(true);
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [lessonId, opened]);

  return (
    <>
      {selected && !opened && (
        <div className="sticky top-0 z-10 flex justify-center">
          <button type="button" className="btn primary sm" onPointerDown={(event) => event.preventDefault()}
            onClick={() => setOpened(selected)}>{t("cls.translateSelection")}</button>
        </div>
      )}
      {opened && (
        <Dialog open title={opened.query} onClose={() => setOpened(null)}>
          <p className="small"><b>{t("cls.contextOriginal")}</b> <span lang="en">{opened.sentence}</span></p>
          {loading && <p role="status">{t("cls.dictLoading")}</p>}
          {!loading && !error && !suggestions.length && <p role="status">{t("cls.contextNoResult")}</p>}
          {error && <p role="status">{t("cls.dictUnavailable")}</p>}
          <ul className="flex flex-col gap-2">
            {suggestions.map((suggestion) => (
              <li className="row" key={suggestion.translation}>
                <div>
                  <b>{suggestion.translation}</b>
                  <div className="small muted">{t("cls.contextExample")} <span lang="en">{suggestion.example}</span></div>
                </div>
              </li>
            ))}
          </ul>
        </Dialog>
      )}
    </>
  );
}
