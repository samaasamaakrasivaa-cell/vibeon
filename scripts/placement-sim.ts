// Прогон вводного теста (ядро: поиск уровня → проверка по группам) на виртуальных учениках:
// npx tsx scripts/placement-sim.ts [warm|expect]   (TRACK=teen — банк Teens)
import fs from "node:fs";
import { coreResult, emptyState, nextCore, nextVocab, stepOf, STEPS, vocabResult, type Bank, type CoreItem, type Group } from "../src/lib/placement/engine";

const TEEN = process.env.TRACK === "teen";
const dir = TEEN ? "content/placement/teen/" : "content/placement/";
const groups = JSON.parse(fs.readFileSync(dir + "00_groups.json", "utf8")) as Group[];
const gOf = new Map(groups.flatMap((g) => g.topics.map((t) => [t, g.id] as const)));
const core = ["01_core_A1", "02_core_A2", "03_core_B1", "04_core_B2", "05_core_C1"].flatMap((f) => JSON.parse(fs.readFileSync(dir + f + ".json", "utf8"))) as CoreItem[];
for (const x of core) x.group = x.group ?? gOf.get(x.topic_id);
const families = JSON.parse(fs.readFileSync(dir + "00_families.json", "utf8"));
const bank: Bank = { groups, families, core, reading: [], listening: [], writing: [], speaking: [] };
let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const MODE = process.argv[2] ?? "warm";
const expectOf = (T: number) => (T <= 2 ? "A1" : T <= 5 ? "B1" : "B2") as "A1" | "B1" | "B2";

for (let T = 0; T <= 8; T++) {
  const res: number[] = [], lens: number[] = [], vres: number[] = [], vlens: number[] = [];
  for (let run = 0; run < 400; run++) {
    const st = emptyState(MODE === "expect" ? expectOf(T) : null, TEEN ? "teen" : "adult");
    for (;;) {
      const nx = nextCore(st, bank, rnd); if (!nx) break;
      const it = nx.item; st.items[it.id] = it;
      const s = stepOf(it.level, it.band);
      st.core.push({ id: it.id, step: s, ph: nx.ph });
      const p = s <= T ? 0.92 : s === T + 1 ? 0.45 : 0.25; // своё — почти всегда, выше — догадка
      st.answers[it.id] = { v: null, ok: rnd() < p };
    }
    res.push(coreResult(st, bank)); lens.push(st.core.length);
    st.step = coreResult(st, bank); const before = st.core.length;
    for (;;) {
      const nx = nextVocab(st, bank, rnd); if (!nx) break;
      const it = nx.item; st.items[it.id] = it; const s = stepOf(it.level, it.band);
      st.core.push({ id: it.id, step: s, ph: nx.ph });
      st.answers[it.id] = { v: null, ok: rnd() < (s <= T ? 0.92 : s === T + 1 ? 0.45 : 0.25) };
    }
    vres.push(vocabResult(st)); vlens.push(st.core.length - before);
  }
  const hit = res.filter((r) => r === T).length / res.length, near = res.filter((r) => Math.abs(r - T) <= 1).length / res.length;
  const vh = vres.filter((r) => r === T).length / vres.length, vn = vres.filter((r) => Math.abs(r - T) <= 1).length / vres.length;
  console.log(`${STEPS[T].padEnd(4)} лексика: точно ${(vh * 100).toFixed(0)}% ±1 ${(vn * 100).toFixed(0)}% заданий ${Math.min(...vlens)}–${Math.max(...vlens)} (в среднем ${(vlens.reduce((a, b) => a + b, 0) / vlens.length).toFixed(1)})`);
  console.log(`${STEPS[T].padEnd(4)} грамматика: точно ${(hit * 100).toFixed(0)}%  ±1 ${(near * 100).toFixed(0)}%  заданий ${Math.min(...lens)}–${Math.max(...lens)} (в среднем ${(lens.reduce((a, b) => a + b, 0) / lens.length).toFixed(1)})`);
}
