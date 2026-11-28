"use client";

import { useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { Dictate } from "../ai/Dictate";

const labels = {
  ru: {
    processing: "При диктовке аудио отправляется в Yandex SpeechKit. Русская расшифровка может передаваться модели в Yandex AI Studio для исправления английских терминов.",
    language: "Язык диктовки",
    cancel: "Отменить диктовку",
  },
  en: {
    processing: "Dictation sends audio to Yandex SpeechKit. Russian transcripts may be sent to a model in Yandex AI Studio to correct English terms.",
    language: "Dictation language",
    cancel: "Cancel dictation",
  },
} as const;

export function PrivateLessonDictation({ lang, initialText, maxLength, placeholder, onBusy }: {
  lang: "ru" | "en"; initialText: string; maxLength: number; placeholder: string; onBusy: (busy: boolean) => void;
}) {
  const t = labels[lang];
  const { pending } = useFormStatus();
  const [busy, setBusy] = useState(false);
  const [language, setLanguage] = useState<"ru-RU" | "en-US">(lang === "ru" ? "ru-RU" : "en-US");
  const text = useRef<HTMLTextAreaElement>(null);

  function append(transcript: string) {
    const field = text.current;
    if (!field) return;
    const separator = field.value && !/\s$/.test(field.value) ? " " : "";
    const addition = (separator + transcript).slice(0, Math.max(0, maxLength - field.value.length)).replace(/[\uD800-\uDBFF]$/, "");
    if (addition.trim()) field.value += addition;
  }

  return <>
    <p id="observation-dictation-processing" className="small muted m-0">{t.processing}</p>
    <div className="dictbox">
      <textarea id="lesson-observation" name="observation" rows={3} maxLength={maxLength} className="input" ref={text}
        placeholder={placeholder} aria-describedby="observation-privacy observation-dictation-processing" defaultValue={initialText} />
      <Dictate round lang={language} onText={append} disabled={pending}
        describedBy="observation-dictation-processing" cancelLabel={t.cancel}
        onBusy={(value) => { setBusy(value); onBusy(value); }} />
    </div>
    <div>
      <select aria-label={t.language} className="select w-auto" value={language} disabled={busy || pending}
        onChange={(event) => setLanguage(event.target.value === "en-US" ? "en-US" : "ru-RU")}>
        <option value="ru-RU">Русский</option><option value="en-US">English</option>
      </select>
    </div>
  </>;
}
