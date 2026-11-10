import "server-only";
import type { CoreItem, ListenItem, PState, ReadItem, SpeakItem, WriteItem } from "./engine";

// Данные для разбора: задания из снимка, ответ ученика, правильный ответ, объяснение.
// Скрипты аудирования ученику не отдаются — только учителю (или после «глазика», отдельным запросом).

export function reviewData(id: string, st: PState, forTeacher: boolean) {
  const core = st.core.map((x) => {
    const it = st.items[x.id] as CoreItem;
    const a = st.answers[x.id];
    const given = a?.v === null || a?.v === undefined ? "" : it.type === "mcq" ? it.options?.[Number(a.v)] ?? "" : String(a.v);
    return {
      id: it.id, level: it.level, step: x.step, skill: it.skill, topic: it.topic_ru, type: it.type, q: it.q, frame: it.frame ?? null, base: it.base ?? it.key ?? null,
      right: it.type === "mcq" ? it.options?.[it.answer ?? 0] ?? "" : (it.accept ?? []).join(" / "), given, ok: !!a?.ok, explain: it.explain_ru, ms: a?.ms ?? null, dk: !!a?.dk,
    };
  });
  const text = (ids: string[], kind: "reading" | "listening") => ids.map((tid) => {
    const it = st.items[tid] as ReadItem | ListenItem;
    return {
      id: it.id, kind, level: it.level, title: it.title,
      passage: it.type === "reading" ? it.passage : null,
      situation: it.type === "listening" ? it.situation_ru ?? "" : null,
      audio: it.type === "listening" ? it.audio ?? null : null,
      plays: it.type === "listening" ? st.plays[it.id] ?? 0 : null,
      script: forTeacher && it.type === "listening" ? it.script.replace(/\[pause [\d.]+s\]\s*/g, "") : null,
      questions: it.questions.map((q) => ({ id: q.id, q: q.q, options: q.options, answer: q.answer, given: st.answers[q.id]?.v ?? null, ok: !!st.answers[q.id]?.ok, dk: !!st.answers[q.id]?.dk, explain: q.explain_ru })),
    };
  });
  const w = st.writing ? (st.items[st.writing.id] as WriteItem) : null;
  const sp = st.speaking ? (st.items[st.speaking.id] as SpeakItem) : null;
  return {
    core,
    reading: text(st.rdone, "reading"),
    listening: text(st.ldone, "listening"),
    writing: w && { prompt_en: w.prompt_en, prompt_ru: w.prompt_ru, level: w.level, min: w.min_words, max: w.max_words, expects: w.expects, text: st.writing?.text ?? "" },
    speaking: sp && {
      level: sp.level, intro: sp.intro_ru, expects: sp.expects, noMic: !!(st.speaking as { noMic?: boolean }).noMic,
      questions: sp.questions.map((q, i) => ({ q: q.q, url: st.speaking?.rec?.[String(i + 1)] ? `/api/placement/${id}/rec/${i + 1}` : null, rerec: st.rerec?.[String(i + 1)] ?? 0 })),
    },
    times: Object.fromEntries(Object.entries(st.times ?? {}).filter(([k, v]) => !k.endsWith("At") && v > 0)) as Record<string, number>,
  };
}
export type ReviewData = ReturnType<typeof reviewData>;

/** Скрипты записей, которые учитель открыл ученику на разборе. */
export function revealedScripts(st: PState, reveal: string[]) {
  return Object.fromEntries(reveal.map((id) => [id, (st.items[id] as ListenItem | undefined)?.script?.replace(/\[pause [\d.]+s\]\s*/g, "") ?? ""]).filter(([, s]) => s));
}
