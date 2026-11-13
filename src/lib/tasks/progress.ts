// «Дорожка» выполнения задания: по пункту на вопрос/пропуск/строку — верно, ошибка, ещё не сделано, сделано (без автопроверки).
// Считается по ответу ученика так же, как проверяют сами задания (TaskView), — для учителя в групповом уроке.
import type { TaskOptions, TaskType } from "./catalog";
import { buildCrossword, dictationGrade, parse, same, type Seg } from "./parse";

export type Step = "ok" | "bad" | "todo" | "done";
type P = Record<string, unknown>;
const rec = <T,>(x: unknown) => ((x && typeof x === "object" ? x : {}) as Record<string, T>);
const filled = (v: unknown) => typeof v === "string" ? !!v.trim() : v != null;

/** null — у задания нет ответа ученика (текст, картинка, видео, рамка…). */
export function progressOf(task: { id: string; type: TaskType; content: string; options: TaskOptions }, a: P | undefined): Step[] | null {
  const p = parse(task.type, task.content);
  const ans = a ?? {};
  switch (task.type) {
    case "gap": case "drag": case "dropdown": {
      if (p.kind !== "gaps") return null;
      const val = rec<string>(ans.val), out: Step[] = [];
      p.lines.forEach((l, li) => l.forEach((s, si) => { if (s.t === "gap") { const v = val[`${li}:${si}`]; out.push(!filled(v) ? "todo" : same(v, s.answers) ? "ok" : "bad"); } }));
      return out;
    }
    case "errors": {
      if (p.kind !== "gaps") return null;
      const found = rec<boolean>(ans.found), fix = rec<string>(ans.fix);
      return p.lines.map((l, i) => {
        const g = l.find((s) => s.t === "gap") as Extract<Seg, { t: "gap" }> | undefined;
        if (!g) return found[i] ? "bad" : "todo"; // строка без ошибки
        if (!found[i] && !filled(fix[i])) return "todo";
        return same(fix[i] ?? "", g.answers) ? "ok" : filled(fix[i]) ? "bad" : "todo";
      });
    }
    case "test": {
      if (p.kind !== "test") return null;
      const sel = rec<number[]>(ans.ans);
      return p.qs.map((q, i) => (!sel[i]?.length ? "todo" : [...sel[i]].sort().join() === [...q.correct].sort().join() ? "ok" : "bad"));
    }
    case "tf": {
      if (p.kind !== "tf") return null;
      const sel = rec<string>(ans.ans);
      return p.items.map((it, i) => (!sel[i] ? "todo" : sel[i] === it.a ? "ok" : "bad"));
    }
    case "pairs": {
      if (p.kind !== "pairs") return null;
      const link = rec<number>(ans.link);
      return p.pairs.map((_, i) => (link[i] === undefined ? "todo" : link[i] === i ? "ok" : "bad"));
    }
    case "columns": case "picture": {
      const buckets = p.kind === "columns" ? p.cols.map((c) => c.words) : p.kind === "words" ? p.items.map((x) => [x.word]) : null;
      if (!buckets) return null;
      const place = rec<number>(ans.place);
      return buckets.flatMap((ws, bi) => ws.map((w) => (place[w] === undefined ? "todo" : place[w] === bi ? "ok" : "bad")));
    }
    case "sentence": case "letters": {
      const items = p.kind === "sentences" ? p.items : p.kind === "words" ? p.items.map((x) => x.word.split("")) : null;
      if (!items) return null;
      const built = rec<number[]>(ans.built), letters = task.type === "letters";
      return items.map((toks, i) => {
        const b = built[i] ?? [];
        if (b.length < toks.length) return "todo";
        const got = b.map((k) => toks[k]).join(letters ? "" : " ");
        return (letters ? got.toLowerCase() === toks.join("").toLowerCase() : same(got, [toks.join(" ")])) ? "ok" : "bad";
      });
    }
    case "textorder": {
      if (p.kind !== "lines") return null;
      const fixed = new Set((task.options.fixed ?? []).filter((i) => i < p.items.length));
      const free = p.items.map((_, i) => i).filter((i) => !fixed.has(i));
      if (!Array.isArray(ans.ord)) return free.map(() => "todo");
      const saved = (ans.ord as number[]).filter((v) => free.includes(v));
      const order = [...saved, ...free.filter((v) => !saved.includes(v))];
      return free.map((pos, k) => (order[k] === pos ? "ok" : "bad"));
    }
    case "transform": case "translate": {
      if (p.kind !== "pairsArrow") return null;
      const val = rec<string>(ans.val);
      return p.items.flatMap((it, i) => (it.answers.length ? [!filled(val[i]) ? "todo" : same(val[i], it.answers) ? "ok" : "bad"] as Step[] : []));
    }
    case "dictation": {
      if (p.kind !== "lines") return null;
      const val = rec<string>(ans.val);
      return p.items.map((x, i) => (!filled(val[i]) ? "todo" : dictationGrade(val[i], x) === "exact" ? "ok" : "bad"));
    }
    case "crossword": {
      if (p.kind !== "words" || !p.items.length) return null;
      const cw = buildCrossword(p.items), cell = rec<string>(ans.cell);
      return cw.words.map((w) => {
        const got = w.word.split("").map((_, i) => (cell[`${w.across ? w.row : w.row + i},${w.across ? w.col + i : w.col}`] ?? "").toUpperCase());
        if (got.some((c) => !c)) return "todo";
        return got.join("") === w.word ? "ok" : "bad";
      });
    }
    // без автопроверки — «сделано / не сделано»
    case "open": {
      if (p.kind !== "lines") return null;
      const val = rec<string>(ans.val);
      return p.items.map((_, i) => (filled(val[i]) ? "done" : "todo"));
    }
    case "essay": return [filled(ans.text) ? "done" : "todo"];
    case "record": case "speak": return [ans.rec ? "done" : "todo"];
    case "mark": return [Object.values(rec<boolean>(ans.sel)).some(Boolean) ? "done" : "todo"];
    default: return null;
  }
}

/** Кратко: сколько верно / сколько всего, есть ли ошибки, закончено ли. */
export const summary = (s: Step[]) => ({ ok: s.filter((x) => x === "ok" || x === "done").length, bad: s.filter((x) => x === "bad").length, total: s.length, done: s.length > 0 && s.every((x) => x !== "todo") });

