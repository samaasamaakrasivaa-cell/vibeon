// Разбор содержания заданий (разметка из Разметка_заданий.md) в структуру для показа и проверки.
import type { TaskType } from "./catalog";

export type Seg = { t: "text"; v: string } | { t: "gap"; answers: string[]; hint?: string; options?: string[] };
export type Parsed =
  | { kind: "gaps"; lines: Seg[][]; bank: string[] } // gap, drag, dropdown, errors
  | { kind: "test"; qs: { q: string; options: string[]; correct: number[] }[] }
  | { kind: "tf"; items: { s: string; a: "T" | "F" | "NS" }[]; ns: boolean }
  | { kind: "pairs"; pairs: [string, string][] }
  | { kind: "columns"; cols: { name: string; words: string[] }[] }
  | { kind: "words"; items: { word: string; hint: string }[] } // picture, letters, crossword
  | { kind: "sentences"; items: string[][] } // sentence (токены)
  | { kind: "lines"; items: string[] } // textorder, speak, dictation, open
  | { kind: "pairsArrow"; items: { q: string; key?: string; answers: string[] }[] } // transform, translate
  | { kind: "wordset"; items: { word: string; tr: string; ex: string }[] }
  | { kind: "text"; text: string };

const stripNum = (l: string) => l.replace(/^\s*(\d+[.)]|[a-zA-Zа-яА-Я][)]|[-•*])\s+/, "");
const lines = (c: string) => c.split(/\r?\n/).map((l) => stripNum(l.trim())).filter(Boolean);
const DASH = /\s+[—–-]\s+/;
const alts = (s: string) => s.split("/").map((x) => x.trim()).filter(Boolean);

/** Строка с [ответами](подсказкой). Для выбора из списка — варианты со *. */
export function parseGapLine(line: string, kind: "gap" | "dropdown" | "errors"): Seg[] {
  const out: Seg[] = [];
  const re = /\[([^\]]+)\](?:\(([^)]*)\))?/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line))) {
    if (m.index > last) out.push({ t: "text", v: line.slice(last, m.index) });
    const raw = m[1].replace(/✓/g, "*").replace(/\|/g, "/");
    const parts = alts(raw);
    if (kind === "gap") {
      out.push({ t: "gap", answers: parts.map((p) => p.replace(/\*$/, "").trim()), hint: m[2]?.trim() || undefined });
    } else {
      const options = parts.map((p) => p.replace(/\*$/, "").trim());
      let answers = parts.filter((p) => p.endsWith("*")).map((p) => p.replace(/\*$/, "").trim());
      if (kind === "errors" && answers.length === 0 && options.length === 2) answers = [options[1]]; // [неверно|верно]
      if (kind === "dropdown" && answers.length === 0) answers = [options[0]];
      out.push({ t: "gap", answers, options, hint: m[2]?.trim() || undefined });
    }
    last = re.lastIndex;
  }
  if (last < line.length) out.push({ t: "text", v: line.slice(last) });
  return out;
}

export function parse(type: TaskType, content: string): Parsed {
  const c = content ?? "";
  switch (type) {
    case "gap":
    case "drag":
    case "dropdown":
    case "errors": {
      const k = type === "dropdown" ? "dropdown" : type === "errors" ? "errors" : "gap";
      const ls = lines(c).map((l) => parseGapLine(l, k));
      const bank = ls.flat().flatMap((s) => (s.t === "gap" ? [s.answers[0]] : [])).filter(Boolean);
      return { kind: "gaps", lines: ls, bank };
    }
    case "test": {
      const blocks = c.split(/\n\s*\n/).map((b) => b.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)).filter((b) => b.length);
      return {
        kind: "test",
        qs: blocks.map((b) => {
          const [q, ...opts] = b;
          const correct = opts.map((o, i) => (/[*✓]\s*$/.test(o) ? i : -1)).filter((i) => i >= 0);
          return { q: stripNum(q), options: opts.map((o) => stripNum(o).replace(/\s*[*✓]\s*$/, "")), correct: correct.length ? correct : [0] };
        }),
      };
    }
    case "tf": {
      const items = lines(c).map((l) => {
        const m = /^(.*?)\s*[—–-]\s*(T|F|NS|True|False|Not stated)\s*$/i.exec(l);
        const a = (m?.[2] ?? "T").toUpperCase();
        return { s: m?.[1] ?? l, a: (a.startsWith("N") ? "NS" : a.startsWith("F") ? "F" : "T") as "T" | "F" | "NS" };
      });
      return { kind: "tf", items, ns: items.some((i) => i.a === "NS") };
    }
    case "pairs":
      return { kind: "pairs", pairs: lines(c).map((l) => l.split(DASH)).filter((p) => p.length >= 2).map((p) => [p[0].trim(), p.slice(1).join(" — ").trim()] as [string, string]) };
    case "columns":
      return {
        kind: "columns",
        cols: lines(c).map((l) => {
          const i = l.indexOf(":");
          return i < 0 ? { name: l, words: [] } : { name: l.slice(0, i).trim(), words: l.slice(i + 1).split(",").map((w) => w.trim()).filter(Boolean) };
        }).filter((x) => x.words.length),
      };
    case "picture":
    case "letters":
    case "crossword":
      return { kind: "words", items: lines(c).map((l) => { const [w, ...h] = l.split(DASH); return { word: w.trim(), hint: h.join(" — ").trim() }; }).filter((x) => x.word) };
    case "sentence":
      return { kind: "sentences", items: lines(c).map((l) => l.split(/\s+/).map((w) => w.replace(/_/g, " ")).filter(Boolean)) };
    case "textorder":
    case "speak":
    case "dictation":
    case "open":
      return { kind: "lines", items: lines(c) };
    case "transform":
    case "translate":
      return {
        kind: "pairsArrow",
        items: lines(c).map((l) => {
          const [left, right = ""] = l.split(/\s*(?:→|->)\s*/);
          const [q, key] = left.split(/\s*\|\s*/);
          return { q: q.trim(), key: key?.trim() || undefined, answers: alts(right) };
        }),
      };
    case "wordset":
      return {
        kind: "wordset",
        items: lines(c).map((l) => { const [word = "", tr = "", ...ex] = l.split(DASH); return { word: word.trim(), tr: tr.trim(), ex: ex.join(" — ").trim() }; }).filter((x) => x.word),
      };
    default:
      return { kind: "text", text: c };
  }
}

// ───────── Проверка ─────────

export const norm = (s: string) =>
  s.toLowerCase().replace(/[’‘`´]/g, "'").replace(/[“”«»]/g, '"').replace(/\s+/g, " ").replace(/^[\s"']+|[\s.,!?;:"']+$/g, "").trim();

export const same = (a: string, answers: string[]) => answers.some((x) => norm(x) === norm(a));

/** Расстояние Левенштейна — для диктанта («орфография»). */
export function lev(a: string, b: string) {
  const m = a.length, n = b.length;
  const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 1; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[m][n];
}

/** exact — точно; spelling — ошибки в написании (≤ 15 % символов); wrong — не совпало. */
export function dictationGrade(input: string, answer: string): "exact" | "spelling" | "wrong" {
  const a = norm(input), b = norm(answer);
  if (a === b) return "exact";
  return lev(a, b) <= Math.max(1, Math.round(b.length * 0.15)) ? "spelling" : "wrong";
}

/** Детерминированное перемешивание (одинаковое на сервере и в браузере). */
export function shuffle<T>(arr: T[], seed: string): T[] {
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0;
    const j = h % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  // не оставляем порядок совпадающим с правильным, если элементов больше одного
  if (a.length > 1 && a.every((x, i) => x === arr[i])) a.push(a.shift()!);
  return a;
}

// ───────── Кроссворд ─────────

export type CwWord = { word: string; clue: string; row: number; col: number; across: boolean; n: number };
export type Crossword = { rows: number; cols: number; words: CwWord[]; grid: (string | null)[][] };

/** Простая раскладка: каждое слово пытаемся пересечь с уже размещёнными. */
export function buildCrossword(items: { word: string; hint: string }[]): Crossword {
  const list = items.map((x) => ({ word: x.word.toUpperCase().replace(/[^A-Z]/g, ""), clue: x.hint })).filter((x) => x.word.length > 1).sort((a, b) => b.word.length - a.word.length);
  const cells = new Map<string, string>();
  const placed: Omit<CwWord, "n">[] = [];
  const key = (r: number, c: number) => `${r},${c}`;
  const fits = (w: string, r: number, c: number, across: boolean) => {
    let crosses = 0;
    for (let i = 0; i < w.length; i++) {
      const rr = across ? r : r + i, cc = across ? c + i : c;
      const v = cells.get(key(rr, cc));
      if (v && v !== w[i]) return -1;
      if (v) crosses++;
      else {
        // соседи сбоку не должны касаться
        const n1 = across ? cells.get(key(rr - 1, cc)) : cells.get(key(rr, cc - 1));
        const n2 = across ? cells.get(key(rr + 1, cc)) : cells.get(key(rr, cc + 1));
        if (n1 || n2) return -1;
      }
    }
    const before = across ? cells.get(key(r, c - 1)) : cells.get(key(r - 1, c));
    const after = across ? cells.get(key(r, c + w.length)) : cells.get(key(r + w.length, c));
    if (before || after) return -1;
    return crosses;
  };
  const put = (w: string, clue: string, r: number, c: number, across: boolean) => {
    for (let i = 0; i < w.length; i++) cells.set(key(across ? r : r + i, across ? c + i : c), w[i]);
    placed.push({ word: w, clue, row: r, col: c, across });
  };
  for (const [idx, it] of list.entries()) {
    if (idx === 0) { put(it.word, it.clue, 0, 0, true); continue; }
    let best: { r: number; c: number; across: boolean; score: number } | null = null;
    for (const p of placed)
      for (let i = 0; i < p.word.length; i++)
        for (let j = 0; j < it.word.length; j++) {
          if (p.word[i] !== it.word[j]) continue;
          const across = !p.across;
          const r = p.across ? p.row - j : p.row + i;
          const c = p.across ? p.col + i : p.col - j;
          const s = fits(it.word, r, c, across);
          if (s > 0 && (!best || s > best.score)) best = { r, c, across, score: s };
        }
    if (best) put(it.word, it.clue, best.r, best.c, best.across);
    else {
      // не пересеклось — ставим ниже отдельной строкой
      const maxR = Math.max(...placed.map((p) => (p.across ? p.row : p.row + p.word.length - 1)));
      put(it.word, it.clue, maxR + 2, 0, true);
    }
  }
  const minR = Math.min(...placed.map((p) => p.row)), minC = Math.min(...placed.map((p) => p.col));
  const norm2 = placed.map((p) => ({ ...p, row: p.row - minR, col: p.col - minC }));
  const rows = Math.max(...norm2.map((p) => (p.across ? p.row + 1 : p.row + p.word.length)));
  const cols = Math.max(...norm2.map((p) => (p.across ? p.col + p.word.length : p.col + 1)));
  const grid: (string | null)[][] = Array.from({ length: rows }, () => Array(cols).fill(null));
  for (const p of norm2) for (let i = 0; i < p.word.length; i++) grid[p.across ? p.row : p.row + i][p.across ? p.col + i : p.col] = p.word[i];
  // нумерация по положению первой клетки
  const starts = [...new Set(norm2.map((p) => p.row * 1000 + p.col))].sort((a, b) => a - b);
  const words = norm2.map((p) => ({ ...p, n: starts.indexOf(p.row * 1000 + p.col) + 1 }));
  return { rows, cols, words, grid };
}

/** Делит строки на серии по N (для «Заполни пропуски» с банком слов). */
export function series<T>(arr: T[], size?: number) {
  if (!size || size <= 0 || arr.length <= size) return [arr];
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/** Встраиваемый плеер для ссылок на видео. */
export function videoEmbed(url: string): { kind: "iframe" | "file"; src: string } | null {
  if (!url) return null;
  let m = /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)([\w-]{11})/.exec(url);
  if (m) return { kind: "iframe", src: `https://www.youtube-nocookie.com/embed/${m[1]}` };
  m = /rutube\.ru\/video\/([\w]+)/.exec(url);
  if (m) return { kind: "iframe", src: `https://rutube.ru/play/embed/${m[1]}` };
  m = /vk(?:video)?\.(?:com|ru)\/video(-?\d+)_(\d+)/.exec(url);
  if (m) return { kind: "iframe", src: `https://vk.com/video_ext.php?oid=${m[1]}&id=${m[2]}&hd=2` };
  if (/\.(mp4|webm|mov|m4v)(\?|$)/i.test(url) || url.startsWith("/api/files/")) return { kind: "file", src: url };
  return { kind: "iframe", src: url };
}
