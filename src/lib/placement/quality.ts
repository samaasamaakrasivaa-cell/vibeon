import "server-only";
import { createHash } from "node:crypto";
import { db } from "../db";
import { PL_LEVELS, STEPS, type CoreItem, type PState } from "./engine";

// «Качество вопросов» (владелец платформы): как ведёт себя каждое задание грамматики на реальных прохождениях.
// Сравниваем с итоговым уровнем, который поставил учитель: задание уровня B2, которое верно делают ученики A2, — слишком лёгкое
// (или его можно угадать); задание B1, на котором ошибаются даже B2, — неоднозначное или слишком трудное. Имён учеников здесь нет.

export type QRow = {
  id: string; level: string; topic: string; type: string; q: string;
  n: number; ok: number; dk: number; below: [number, number]; atOrAbove: [number, number];
  topWrong: { v: string; n: number } | null; wrongN: number; flag: "easy" | "hard" | "trap" | null;
};
const MIN = 8; // минимум ответов в группе для вывода
const lvIdx = (s: string) => PL_LEVELS.indexOf(s.replace(/[+-]$/, "") as never);

async function attempts() {
  const rows = await db.placementAttempt.findMany({
    where: { track: "adult", status: { in: ["submitted", "reviewed"] }, level: { not: null } },
    orderBy: { submittedAt: "desc" }, take: 600, select: { id: true, level: true, state: true },
  });
  return rows.map((r) => ({ id: r.id, level: r.level!, st: r.state as unknown as PState }));
}

export async function qualityData() {
  const list = await attempts();
  const by = new Map<string, QRow & { wrongs: Map<string, number> }>();
  for (const a of list) {
    const fin = lvIdx(a.level);
    for (const x of a.st.core ?? []) {
      const it = a.st.items?.[x.id] as CoreItem | undefined; const ans = a.st.answers?.[x.id];
      if (!it || !ans || it.skill !== "grammar") continue;
      const r = by.get(it.id) ?? { id: it.id, level: it.level, topic: it.topic_ru, type: it.type, q: it.q, n: 0, ok: 0, dk: 0, below: [0, 0], atOrAbove: [0, 0], topWrong: null, wrongN: 0, flag: null, wrongs: new Map() };
      r.n++; if (ans.ok) r.ok++; if (ans.dk) r.dk++;
      const li = lvIdx(it.level);
      const bucket = fin < li ? r.below : r.atOrAbove;
      bucket[1]++; if (ans.ok) bucket[0]++;
      if (!ans.ok && !ans.dk && ans.v !== null) {
        const v = it.type === "mcq" ? it.options?.[Number(ans.v)] ?? String(ans.v) : String(ans.v).toLowerCase().trim();
        r.wrongs.set(v, (r.wrongs.get(v) ?? 0) + 1); r.wrongN++;
      }
      by.set(it.id, r);
    }
  }
  const rows: QRow[] = [...by.values()].map(({ wrongs, ...r }) => {
    const top = [...wrongs.entries()].sort((a, b) => b[1] - a[1])[0];
    const topWrong = top ? { v: top[0], n: top[1] } : null;
    const flag = r.below[1] >= MIN && r.below[0] / r.below[1] >= 0.7 ? "easy"
      : r.atOrAbove[1] >= MIN && r.atOrAbove[0] / r.atOrAbove[1] < 0.5 ? "hard"
      : topWrong && r.wrongN >= MIN && topWrong.n / r.wrongN >= 0.6 ? "trap" : null;
    return { ...r, topWrong, flag };
  });
  return { attempts: list.length, items: rows.length, enough: rows.filter((r) => r.n >= MIN).length, rows: rows.sort((a, b) => Number(!!b.flag) - Number(!!a.flag) || b.n - a.n) };
}

/** Выгрузка для анализа: по строке на ответ, без имён — прохождение обозначено коротким кодом. */
export async function qualityCsv() {
  const list = await attempts();
  const esc = (v: unknown) => { const s = String(v ?? ""); return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const head = ["attempt", "teacher_level", "test_grammar", "n", "phase", "item", "item_level", "band", "topic", "type", "ok", "dont_know", "typo", "sure", "ms", "answer"];
  const lines = [head.join(",")];
  for (const a of list) {
    const code = createHash("sha256").update(a.id).digest("hex").slice(0, 10);
    const step = typeof a.st.step === "number" ? STEPS[a.st.step] : "";
    (a.st.core ?? []).forEach((x, i) => {
      const it = a.st.items?.[x.id] as CoreItem | undefined; const ans = a.st.answers?.[x.id];
      if (!it || !ans || (it.skill !== "grammar" && it.skill !== "vocabulary")) return;
      const given = ans.v === null ? "" : it.type === "mcq" ? it.options?.[Number(ans.v)] ?? "" : String(ans.v);
      lines.push([code, a.level, step, i + 1, x.ph ?? "", it.id, it.level, it.band, it.topic_ru, it.type, ans.ok ? 1 : 0, ans.dk ? 1 : 0, ans.ty ? 1 : 0, ans.cf ?? "", ans.ms ?? "", given].map(esc).join(","));
    });
  }
  return "﻿" + lines.join("\n");
}
