"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useT } from "@/lib/i18n/client";
import { resetBankItem, saveBankItem } from "@/lib/placement/bank-actions";
import type { AnyItem, CoreItem, ListenItem, Q, ReadItem, SpeakItem, WriteItem } from "@/lib/placement/engine";
import { useRun } from "../courses/useRun";
import { Dialog } from "../Dialog";
import { Icon } from "../Icon";

const GROUPS = [["core", "pl.part.core"], ["reading", "pl.part.reading"], ["listening", "pl.part.listening"], ["writing", "pl.part.writing"], ["speaking", "pl.part.speaking"]] as const;
const groupOf = (x: AnyItem) => (x.skill === "grammar" || x.skill === "vocabulary" ? "core" : x.skill);
const short = (x: AnyItem) => {
  if ("q" in x && typeof x.q === "string") return x.q;
  if (x.type === "reading" || x.type === "listening") return x.title;
  if (x.type === "writing") return x.prompt_en;
  return (x as SpeakItem).questions.map((q) => q.q).join(" · ");
};

/** Режим владельца: правка заданий вводного теста и замена озвучки. */
export function BankEditor({ items, edited, audioEdited }: { items: AnyItem[]; edited: string[]; audioEdited: string[] }) {
  const { t } = useT();
  const [g, setG] = useState<(typeof GROUPS)[number][0]>("core");
  const [lvl, setLvl] = useState("A1");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<AnyItem | null>(null);
  const list = useMemo(() => items.filter((x) => groupOf(x) === g && (g !== "core" || x.level === lvl) && (!q.trim() || `${x.id} ${short(x)}`.toLowerCase().includes(q.trim().toLowerCase()))), [items, g, lvl, q]);
  return (
    <div className="flex flex-col gap-4">
      <nav className="tabsbar">{GROUPS.map(([k, label]) => <button key={k} type="button" aria-current={g === k ? "page" : undefined} onClick={() => setG(k)}>{t(label)}</button>)}</nav>
      <div className="flex flex-wrap items-center gap-2">
        {g === "core" && ["A1", "A2", "B1", "B2", "C1"].map((l) => <button key={l} type="button" className={`pchip ${lvl === l ? "on" : ""}`} aria-pressed={lvl === l} onClick={() => setLvl(l)}>{l}</button>)}
        <input className="input grow" style={{ maxWidth: 320 }} placeholder={t("sch.search")} value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <section className="card p-0">
        {list.map((x) => (
          <button key={x.id} type="button" className="plrow w-full text-left" onClick={() => setOpen(x)}>
            <span className="small muted shrink-0" style={{ width: 92 }}>{x.id}</span>
            <span className="grow truncate">{short(x)}</span>
            {edited.includes(x.id) && <span className="pill orange">{t("pl.edited")}</span>}
            {audioEdited.includes(x.id) && <span className="pill">{t("pl.ownAudio")}</span>}
            <Icon name="pencil" size="sm" />
          </button>
        ))}
        {list.length === 0 && <p className="hint m-0 p-4">{t("sch.nothingFound")}</p>}
      </section>
      {open && <ItemDialog key={open.id} item={open} edited={edited.includes(open.id)} onClose={() => setOpen(null)} />}
    </div>
  );
}

function ItemDialog({ item, edited, onClose }: { item: AnyItem; edited: boolean; onClose: () => void }) {
  const { t } = useT();
  const router = useRouter();
  const { run, pending, error, setError } = useRun();
  const [d, setD] = useState<Record<string, unknown>>(() => JSON.parse(JSON.stringify(item)));
  const [up, setUp] = useState<string | null>(null);
  const set = (k: string, v: unknown) => setD((x) => ({ ...x, [k]: v }));
  const field = (k: string, label: string, long = false) => (
    <div className="field"><label htmlFor={`be-${k}`}>{label}</label>
      {long ? <textarea id={`be-${k}`} className="textarea" style={{ minHeight: 120 }} value={String(d[k] ?? "")} onChange={(e) => set(k, e.target.value)} />
        : <input id={`be-${k}`} className="input" value={String(d[k] ?? "")} onChange={(e) => set(k, e.target.value)} />}
    </div>
  );
  const lines = (k: string, label: string) => (
    <div className="field"><label htmlFor={`be-${k}`}>{label}</label>
      <textarea id={`be-${k}`} className="textarea" value={((d[k] as string[]) ?? []).join("\n")} onChange={(e) => set(k, e.target.value.split("\n"))} />
    </div>
  );
  const options = (opts: string[], answer: number, onChange: (o: string[], a: number) => void, name: string) => (
    <div className="flex flex-col gap-1.5">
      {opts.map((o, i) => (
        <label key={i} className="flex items-center gap-2">
          <input type="radio" name={name} checked={answer === i} onChange={() => onChange(opts, i)} aria-label={t("pl.correct")} />
          <input className="input grow" value={o} onChange={(e) => onChange(opts.map((x, j) => (j === i ? e.target.value : x)), answer)} />
        </label>
      ))}
      <span className="small muted">{t("pl.radioHint")}</span>
    </div>
  );
  const questions = () => {
    const qs = d.questions as Q[];
    const upd = (i: number, p: Partial<Q>) => set("questions", qs.map((x, j) => (j === i ? { ...x, ...p } : x)));
    return qs.map((x, i) => (
      <div key={x.id} className="dblk flex flex-col gap-2">
        <b className="small">{t("pl.question")} {i + 1}</b>
        <input className="input" value={x.q} onChange={(e) => upd(i, { q: e.target.value })} aria-label={t("pl.question")} />
        {options(x.options, x.answer, (o, a) => upd(i, { options: o, answer: a }), x.id)}
        <input className="input" value={x.explain_ru} onChange={(e) => upd(i, { explain_ru: e.target.value })} placeholder={t("pl.explain")} aria-label={t("pl.explain")} />
      </div>
    ));
  };
  const save = () => run(() => saveBankItem(item.id, d), () => { onClose(); router.refresh(); });
  const uploadAudio = async (f: File | undefined) => {
    if (!f) return;
    setUp(t("pl.uploading")); setError(null);
    const fd = new FormData(); fd.append("file", f);
    const r = await fetch(`/api/placement/bank-audio/${item.id}`, { method: "POST", body: fd }).catch(() => null);
    setUp(r?.ok ? t("pl.audioReplaced") : t("pl.audioFail"));
    if (r?.ok) router.refresh();
  };
  const script = item.type === "listening" ? String(d.script ?? "") : "";
  return (
    <Dialog open onClose={onClose} title={`${item.id} · ${item.level}`} wide>
      <div className="flex flex-col gap-3">
        {(item.type === "mcq" || item.type === "gap" || item.type === "wordform" || item.type === "transform") && (
          <>
            <p className="small muted m-0">{(item as CoreItem).topic_ru} · {t(`pl.type.${item.type}` as "pl.type.mcq")}</p>
            {item.type === "transform" && field("key", t("pl.keyWord"))}
            {item.type === "wordform" && field("base", t("pl.baseWord"))}
            {field("q", item.type === "transform" ? t("pl.origSentence") : t("pl.sentence"))}
            {item.type === "transform" && field("frame", t("pl.frame"))}
            {item.type === "mcq"
              ? options(d.options as string[], d.answer as number, (o, a) => setD((x) => ({ ...x, options: o, answer: a })), "opt")
              : <div className="field"><label htmlFor="be-acc">{t("pl.accept")}</label><input id="be-acc" className="input" value={((d.accept as string[]) ?? []).join(" / ")} onChange={(e) => set("accept", e.target.value.split("/").map((x) => x.trim()))} /><span className="small muted">{t("pl.acceptHint")}</span></div>}
            {field("explain_ru", t("pl.explain"))}
          </>
        )}
        {item.type === "reading" && <>{field("title", t("pl.titleF"))}{field("passage", t("pl.textF"), true)}{questions()}</>}
        {item.type === "listening" && (
          <>
            {field("title", t("pl.titleF"))}
            {field("situation_ru", t("pl.situation"))}
            <div className="dblk flex flex-col gap-2">
              <b className="small">{t("pl.audio")}</b>
              <audio controls preload="none" src={(item as ListenItem).audio} className="w-full" />
              <div className="flex flex-wrap items-center gap-2">
                <label className="btn secondary sm"><Icon name="dl" size="sm" />{t("pl.replaceAudio")}<input type="file" accept="audio/*" hidden onChange={(e) => uploadAudio(e.target.files?.[0])} /></label>
                <button type="button" className="btn plain sm" disabled={pending} onClick={() => run(() => resetBankItem(item.id, true), () => router.refresh())}>{t("pl.origAudio")}</button>
                {up && <span className="small muted">{up}</span>}
              </div>
              <span className="small muted">{t("pl.audioHint")}</span>
            </div>
            <div className="field">
              <div className="flex items-center gap-2"><label htmlFor="be-script" className="grow">{t("pl.script")}</label><button type="button" className="btn plain sm" onClick={() => navigator.clipboard.writeText(script)}><Icon name="copy" size="sm" />{t("pl.copy")}</button></div>
              <textarea id="be-script" className="textarea" style={{ minHeight: 220 }} value={script} onChange={(e) => set("script", e.target.value)} />
              <span className="small muted">{t("pl.scriptHint")}</span>
            </div>
            {questions()}
          </>
        )}
        {item.type === "writing" && (
          <>
            {field("prompt_en", t("pl.promptEn"), true)}{field("prompt_ru", t("pl.promptRu"))}
            <div className="grid grid-cols-2 gap-3">{field("min_words", t("pl.minWords"))}{field("max_words", t("pl.maxWords"))}</div>
            {lines("expects", t("pl.expects"))}
          </>
        )}
        {item.type === "speaking" && (
          <>
            {field("intro_ru", t("pl.intro"))}
            {(d.questions as SpeakItem["questions"]).map((x, i) => (
              <div key={i} className="dblk flex flex-col gap-2">
                <b className="small">{t("pl.question")} {i + 1}</b>
                <input className="input" value={x.q} onChange={(e) => set("questions", (d.questions as SpeakItem["questions"]).map((y, j) => (j === i ? { ...y, q: e.target.value } : y)))} aria-label={t("pl.question")} />
                <span className="small muted">{t("pl.prepSpeak", { p: x.prep_sec, s: x.speak_sec })}{x.q !== (item as SpeakItem).questions[i].q ? ` · ${t("pl.qAudioOff")}` : ""}</span>
              </div>
            ))}
            {lines("expects", t("pl.expects"))}
          </>
        )}
        {(item.type === "writing" || item.type === "speaking") && <p className="small muted m-0">{(item as WriteItem | SpeakItem).topic_ru}</p>}
        {item.type === "reading" && <p className="small muted m-0">{(item as ReadItem).topic_ru}</p>}
        {error && <div className="alert">{t("pl.saveErr")}: {error}</div>}
        <div className="actions">
          {edited && <button className="btn plain" disabled={pending} onClick={() => { if (confirm(t("pl.resetConfirm"))) run(() => resetBankItem(item.id), () => { onClose(); router.refresh(); }); }}>{t("pl.reset")}</button>}
          <button className="btn secondary" onClick={onClose}>{t("common.cancel")}</button>
          <button className="btn primary" disabled={pending} onClick={save}>{t("common.save")}</button>
        </div>
      </div>
    </Dialog>
  );
}
