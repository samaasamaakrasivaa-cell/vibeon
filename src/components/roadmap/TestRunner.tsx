"use client";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useT } from "@/lib/i18n/client";
import { submitTest } from "@/lib/roadmap/actions";
import { SKILL_NAME, txt, type Skill } from "@/lib/roadmap/cefr";
import type { Item } from "@/lib/roadmap/testbank";
import { say } from "../ai/audio";
import { Icon } from "../Icon";

type PItem = Omit<Item, "answer">;
const ORDER: Skill[] = ["grammar", "vocabulary", "reading", "listening", "writing"];

/** Тест по разделам: грамматика → лексика → чтение → аудирование (платформа зачитывает фразу) → письмо. */
export function TestRunner({ id, items, writing }: { id: string; items: PItem[]; writing: string }) {
  const { t, lang } = useT();
  const router = useRouter();
  const sections = useMemo(() => ORDER.filter((k) => k === "writing" || items.some((x) => x.skill === k)), [items]);
  const [si, setSi] = useState(0);
  const [ans, setAns] = useState<Record<string, number>>({});
  const [text, setText] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const sk = sections[si];
  const list = items.filter((x) => x.skill === sk);
  const answered = Object.keys(ans).length;
  const passages = [...new Set(list.map((x) => x.passage).filter(Boolean))] as string[];
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  const finish = () => start(async () => {
    setErr(null);
    const r = await submitTest(id, ans, text);
    if (!r.ok) { setErr(r.error); return; }
    router.refresh();
  });
  const q = (x: PItem, n: number) => (
    <fieldset key={x.id} className="tq">
      <legend><span className="tk-num">{n}</span>{x.say && <button type="button" className="btn tinted sm mr-2" onClick={() => say(x.say!)}><Icon name="sound" size="sm" />{t("ts.listen")}</button>}{x.q}</legend>
      <div className="flex flex-wrap gap-2">
        {x.options.map((o, k) => (
          <label key={k} className={`topt ${ans[x.id] === k ? "on" : ""}`}><input type="radio" name={x.id} checked={ans[x.id] === k} onChange={() => setAns({ ...ans, [x.id]: k })} />{o}</label>
        ))}
      </div>
    </fieldset>
  );
  let n = items.filter((x) => sections.indexOf(x.skill) < si).length;
  return (
    <div className="flex flex-col gap-4">
      <div className="testprog">
        {sections.map((k, i) => <button key={k} type="button" className={`${i === si ? "on" : ""} ${i < si ? "done" : ""}`} onClick={() => setSi(i)}>{txt(SKILL_NAME[k], lang)}</button>)}
      </div>
      <section className="card flex flex-col gap-5">
        {sk === "writing" ? (
          <div className="field">
            <label htmlFor="ts-w" className="font-semibold">{writing}</label>
            <textarea id="ts-w" className="textarea" style={{ minHeight: 200 }} value={text} onChange={(e) => setText(e.target.value)} />
            <span className="small muted">{t("tk.words", { n: words })} · {t("ts.writingHint")}</span>
          </div>
        ) : (
          <>
            {passages.map((p, i) => <div key={i} className="tpassage">{p}</div>)}
            {list.map((x) => q(x, ++n))}
          </>
        )}
      </section>
      {err && <div className="alert">{err}</div>}
      <div className="flex items-center justify-between gap-3">
        <span className="small muted">{t("ts.answered", { a: answered, b: items.length })}</span>
        <div className="flex gap-2">
          {si > 0 && <button className="btn secondary" onClick={() => setSi(si - 1)}>{t("common.back")}</button>}
          {si < sections.length - 1 ? <button className="btn primary" onClick={() => { setSi(si + 1); window.scrollTo({ top: 0 }); }}>{t("ts.next")}</button>
            : <button className="btn primary" disabled={pending} onClick={finish}>{pending ? t("ai.checking") : t("ts.finish")}</button>}
        </div>
      </div>
    </div>
  );
}
