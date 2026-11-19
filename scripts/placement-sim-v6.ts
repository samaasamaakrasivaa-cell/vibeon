// Прогон v6 (взрослые) на виртуальных учениках: у каждого — истинная ступень T (A1…C1) и знание каждой темы.
// npx tsx scripts/placement-sim-v6.ts [N] [start]   start — ожидаемый уровень учителя: A1 / B1 / B2 (по умолчанию не указан)
import fs from "node:fs";
import { buildFix, coreResult, ladderLevel, PL_LEVELS, emptyState, nextCore, stepOf, STEPS, summarizeV6, type Bank, type CoreItem, type Group } from "../src/lib/placement/engine";

const dir = "content/placement/";
const groups = JSON.parse(fs.readFileSync(dir + "00_groups.json", "utf8")) as Group[];
const gOf = new Map(groups.flatMap((g) => g.topics.map((t) => [t, g.id] as const)));
const core = ["01_core_A1", "02_core_A2", "03_core_B1", "04_core_B2", "05_core_C1"].flatMap((f) => JSON.parse(fs.readFileSync(dir + f + ".json", "utf8"))) as CoreItem[];
for (const x of core) x.group = x.group ?? gOf.get(x.topic_id);
const prereq = JSON.parse(fs.readFileSync(dir + "00_prereq.json", "utf8"));
const bank: Bank = { groups, families: JSON.parse(fs.readFileSync(dir + "00_families.json", "utf8")), core, reading: [], listening: [], writing: [], speaking: [],
  fix: buildFix(core.filter((x) => x.skill === "grammar"), JSON.parse(fs.readFileSync(dir + "09_fix.json", "utf8"))), prereq };
let seed = Number(process.env.SEED ?? 7); const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const N = Number(process.argv[2] ?? 300), START = process.argv[3] as "A1" | "B1" | "B2" | undefined;
const typed = (it: CoreItem) => it.type !== "mcq" && it.type !== "fix";
const feats: { T: number; D: number; up: number; h: number; hn: number; acc: number }[] = [];
let totQ = 0, totLad = 0, n = 0, topicOk = 0, topicN = 0, gapFound = 0, gapN = 0, gapMissed = 0;
for (let T = 0; T <= 8; T++) {
  const res: number[] = [], lens: number[] = [];
  for (let r = 0; r < N; r++) {
    const st = emptyState(START ?? null, "adult");
    if (process.env.OLD) { st.v6 = undefined; if (!START) { st.start = undefined; st.warm = 3; } }
    const know = new Map<string, boolean>();
    const knows = (it: CoreItem) => {
      if (!know.has(it.topic_id)) { const s = stepOf(it.level, 1); know.set(it.topic_id, rnd() < (s <= T - 1 ? 0.92 : s <= T ? 0.82 : s === T + 1 ? 0.45 : 0.15)); }
      return know.get(it.topic_id)!;
    };
    for (;;) {
      const nx = nextCore(st, bank, rnd); if (!nx) break;
      const it = nx.item; st.items[it.id] = it;
      st.core.push({ id: it.id, step: stepOf(it.level, it.band), ph: nx.ph });
      const k = knows(it);
      const p = k ? (typed(it) ? 0.88 : 0.92) : typed(it) ? 0.08 : it.type === "fix" ? 0.1 : 0.3;
      const ok = rnd() < p;
      const ms = (typed(it) ? 9000 : 6000) + rnd() * 14000 + (ok ? 0 : 3000);
      const ask = nx.ph === "t" || nx.ph === "c" || nx.ph === "g";
      st.answers[it.id] = { v: null, ok, ms, ...(ask ? { cf: (rnd() < (ok ? (k ? 0.88 : 0.35) : (k ? 0.6 : 0.3)) ? 1 : 0) as 0 | 1 } : {}) };
    }
    const g = st.core.filter((x) => !x.ph?.startsWith("v")).length;
    if (st.v6 && st.diag !== undefined) { const D = st.diag; const hard = st.core.filter((x) => { const it = st.items[x.id] as CoreItem; return it.skill === "grammar" && it.level === PL_LEVELS[D] && it.band > 1 && (x.ph === "t" || x.ph === "q" || x.ph === "c"); }); const h = hard.length ? hard.filter((x) => st.answers[x.id].ok).length / hard.length : -1; const all = st.core.filter((x) => { const it = st.items[x.id] as CoreItem; return it.skill === "grammar" && it.level === PL_LEVELS[D] && (x.ph === "t" || x.ph === "q" || x.ph === "c"); }); feats.push({ T, D, up: D < 4 ? ladderLevel(st, D + 1).p : -1, h, hn: hard.length, acc: all.filter((x) => st.answers[x.id].ok).length / Math.max(1, all.length) }); }
    res.push(coreResult(st, bank)); lens.push(g); totQ += g; totLad += (st.ld ?? []).reduce((a, s) => a + s.ids.length, 0); n++;
    for (const t of summarizeV6(st, bank).topics) { topicN++; const truth = know.get(t.id); const said = t.verdict === "own"; if (said === truth) topicOk++; if (truth === false) { gapN++; if (t.verdict === "gap" || t.verdict === "part") gapFound++; if (t.verdict === "own") gapMissed++; } }
  }
  const hit = res.filter((x) => x === T).length / N, near = res.filter((x) => Math.abs(x - T) <= 1).length / N;
  const sorted = [...lens].sort((a, b) => a - b);
  console.log(`${STEPS[T].padEnd(4)} грамматика: точно ${(hit * 100).toFixed(0)}%  ±1 ${(near * 100).toFixed(0)}%  заданий ${sorted[0]}–${sorted[sorted.length - 1]} (в среднем ${(lens.reduce((a, b) => a + b, 0) / N).toFixed(1)}, медиана ${sorted[Math.floor(N / 2)]})`);
}
console.log(`\nв среднем заданий: ${(totQ / n).toFixed(1)}, из них лесенка ${(totLad / n).toFixed(1)}`);
console.log(`темы найденного уровня: вывод «владеет / не владеет» верен в ${(topicOk / topicN * 100).toFixed(0)}% · пробел найден ${(gapFound / gapN * 100).toFixed(0)}%, пропущен (засчитан «владеет») ${(gapMissed / gapN * 100).toFixed(0)}%`);

if (process.env.FEATS) fs.writeFileSync(process.env.FEATS, JSON.stringify(feats));
