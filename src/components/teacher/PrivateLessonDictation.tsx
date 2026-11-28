"use client";

import { useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { translate } from "@/lib/i18n/dict";
import { Icon } from "../Icon";

type Language = "ru-RU" | "en-US";
type Result = { isFinal: boolean; 0?: { transcript: string } };
type Recognition = {
  processLocally: boolean;
  lang: Language;
  continuous: boolean;
  interimResults: boolean;
  onstart: (() => void) | null;
  onaudiostart: (() => void) | null;
  onresult: ((event: { results: ArrayLike<Result> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
};
type RecognitionClass = {
  new (): Recognition;
  available?: (options: { langs: Language[]; processLocally: true }) => Promise<string>;
};
type Phase = "idle" | "checking" | "starting" | "recording" | "stopping";
type Issue = "unavailable" | "permission" | "failed" | "empty" | "full";
type Attempt = { recognition: Recognition | null; transcript: string; started: boolean };

function localRecognition() {
  if (!window.isSecureContext) return null;
  const api = (window as Window & { SpeechRecognition?: RecognitionClass }).SpeechRecognition;
  return typeof api === "function" && typeof api.available === "function" ? api : null;
}

function abort(recognition: Recognition | null) {
  try { recognition?.abort(); } catch { /* The browser may have already ended this session. */ }
}

const labels = {
  ru: {
    language: "Язык диктовки", cancel: "Отменить диктовку",
    checking: "Проверяем язык…", starting: "Включаем микрофон…", recording: "Запись на устройстве началась.",
    unavailable: "Диктовка для этого языка недоступна. Заметку можно набрать.",
    permission: "Микрофон недоступен. Проверьте разрешение или наберите заметку.",
    failed: "Диктовка прервалась. Можно повторить или набрать заметку.",
    empty: "Речь не распознана. Можно повторить.", full: "Достигнут лимит длины заметки.",
  },
  en: {
    language: "Dictation language", cancel: "Cancel dictation",
    checking: "Checking the language…", starting: "Starting the microphone…", recording: "Recording on this device started.",
    unavailable: "Dictation is unavailable for this language. You can type your note.",
    permission: "Microphone unavailable. Check permission or type your note.",
    failed: "Dictation was interrupted. Try again or type your note.",
    empty: "No speech was recognized. You can try again.", full: "The note reached its length limit.",
  },
} as const;

export function PrivateLessonDictation({ lang, initialText, maxLength, placeholder, onBusy }: {
  lang: "ru" | "en"; initialText: string; maxLength: number; placeholder: string; onBusy: (busy: boolean) => void;
}) {
  const t = labels[lang];
  const [supported, setSupported] = useState(false);
  const [language, setLanguage] = useState<Language>(lang === "ru" ? "ru-RU" : "en-US");
  const [phase, setPhase] = useState<Phase>("idle");
  const [issue, setIssue] = useState<Issue | null>(null);
  const [seconds, setSeconds] = useState(0);
  const text = useRef<HTMLTextAreaElement>(null);
  const active = useRef<Attempt | null>(null);
  const { pending } = useFormStatus();

  useEffect(() => {
    setSupported(!!localRecognition());
    const abandon = () => {
      const attempt = active.current;
      active.current = null;
      abort(attempt?.recognition ?? null);
    };
    const leave = () => {
      abandon();
      setPhase("idle");
      setIssue(null);
      onBusy(false);
    };
    window.addEventListener("pagehide", leave);
    return () => {
      window.removeEventListener("pagehide", leave);
      abandon();
    };
  }, [onBusy]);

  useEffect(() => {
    if (phase !== "recording") return;
    const startedAt = performance.now();
    const timer = window.setInterval(() => setSeconds(Math.floor((performance.now() - startedAt) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, [phase]);

  function finish(attempt: Attempt, issue: Issue | null, commit = false) {
    if (active.current !== attempt) return;
    active.current = null;
    if (commit && text.current) {
      const current = text.current.value;
      const transcript = attempt.transcript.trim();
      const addition = transcript && current && !/\s$/.test(current) ? ` ${transcript}` : transcript;
      const tail = addition.slice(0, Math.max(0, maxLength - current.length)).replace(/[\uD800-\uDBFF]$/, "");
      if (tail.trim()) text.current.value = current + tail;
      issue = !transcript ? "empty" : tail.length < addition.length ? "full" : null;
    } else {
      abort(attempt.recognition);
    }
    setIssue(issue);
    setPhase("idle");
    onBusy(false);
  }

  async function start() {
    if (active.current || pending) return;
    const api = localRecognition();
    if (!api?.available) return setIssue("unavailable");
    const attempt: Attempt = { recognition: null, transcript: "", started: false };
    active.current = attempt;
    setIssue(null);
    setSeconds(0);
    setPhase("checking");
    onBusy(true);
    try {
      const ready = await api.available({ langs: [language], processLocally: true });
      if (active.current !== attempt) return;
      if (ready !== "available") return finish(attempt, "unavailable");
      const recognition = new api();
      attempt.recognition = recognition;
      if (typeof recognition.processLocally !== "boolean") return finish(attempt, "unavailable");
      recognition.processLocally = true;
      if (recognition.processLocally !== true) return finish(attempt, "unavailable");
      recognition.lang = language;
      recognition.continuous = true;
      recognition.interimResults = false;
      recognition.onstart = recognition.onaudiostart = () => {
        if (active.current !== attempt) return abort(recognition);
        if (!attempt.started) {
          attempt.started = true;
          setPhase("recording");
        }
      };
      recognition.onresult = ({ results }) => {
        if (active.current === attempt) {
          attempt.transcript = Array.from(results).filter((result) => result.isFinal)
            .map((result) => result[0]?.transcript.trim()).filter(Boolean).join(" ");
        }
      };
      recognition.onerror = ({ error }) => finish(attempt,
        error === "not-allowed" || error === "service-not-allowed" ? "permission" : "failed");
      recognition.onend = () => finish(attempt, null, true);
      setPhase("starting");
      recognition.start();
    } catch {
      finish(attempt, "failed");
    }
  }

  function stop() {
    const attempt = active.current;
    if (!attempt?.started || !attempt.recognition) return;
    setPhase("stopping");
    try { attempt.recognition.stop(); } catch { finish(attempt, "failed"); }
  }

  const ready = supported && phase === "idle";
  const recording = phase === "recording";
  const clock = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  const dictate = translate(lang, "dict.go");
  const stage = phase === "stopping" ? translate(lang, "dict.busy") : phase !== "idle" ? t[phase] : null;

  return <>
    <div className={ready ? "dictbox" : undefined}>
      <textarea id="lesson-observation" name="observation" rows={3} maxLength={maxLength} className="input" ref={text}
        placeholder={placeholder} aria-describedby="observation-privacy" defaultValue={initialText} />
      {ready && <span className="dict round">
        <button type="button" className="dict-mic disabled:opacity-50" disabled={pending} onClick={start} aria-label={dictate} title={dictate}>
          <Icon name="mic" />
        </button>
      </span>}
    </div>
    {ready && <div>
      <select aria-label={t.language} className="select w-auto" value={language} disabled={pending}
        onChange={(event) => { setLanguage(event.target.value as Language); setIssue(null); }}>
        <option value="ru-RU">Русский</option><option value="en-US">English</option>
      </select>
    </div>}
    {phase !== "idle" && <div className={`dict-bar ${recording ? "rec" : "busy"} flex-wrap`}>
      <span className={recording ? "dict-dot" : "dict-spin"} aria-hidden="true" />
      <span className="dict-lbl grow" aria-hidden="true">{recording ? translate(lang, "dict.rec", { t: clock }) : stage}</span>
      {recording && <button type="button" className="btn danger sm" onClick={stop}>
        <span className="dict-sq" aria-hidden="true" />{translate(lang, "dict.stop")}
      </button>}
      <button type="button" className="btn plain sm" onClick={() => { if (active.current) finish(active.current, null); }}>{t.cancel}</button>
    </div>}
    <p className={issue ? "small muted m-0" : "sr-only"} role="status" aria-live="polite">{issue ? t[issue] : stage}</p>
  </>;
}
