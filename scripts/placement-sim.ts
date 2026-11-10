// Прогон вводного теста (ядро: поиск уровня → проверка по группам) на виртуальных учениках:
// npx tsx scripts/placement-sim.ts [warm|expect]
import fs from "node:fs";
import { coreResult, emptyState, nextCore, stepOf, STEPS, type Bank, type CoreItem, type Group } from "../src/lib/placement/engine";

const dir = "content/placement/";
const groups = JSON.parse(fs.readFileSync(dir + "00_groups.json", "utf8")) as Group[];
const gOf = new Map(groups.flatMap((g) => g.topics.map((t) => [t, g.id] as const)));
const core = ["01_core_A1", "02_core_A2", "03_core_B1", "04_core_B2", "05_core_C1"].flatMap((f) => JSON.parse(fs.readFileSync(dir + f + ".json", "utf8"))) as CoreItem[];
for (const x of core) x.group = gOf.get(x.topic_id);
const bank: Bank = { groups, core, reading: [], listening: [], writing: [], speaking: [] };
let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const MODE = process.argv[2] ?? "warm";
const expectOf = (T: number) => (T <= 2 ? "A1" : T <= 5 ? "B1" : "B2") as "A1" | "B1" | "B2";

for (let T = 0; T <= 8; T++) {
  const res: number[] = [], lens: number[] = [];
  for (let run = 0; run < 400; run++) {
    const st = emptyState(MODE === "expect" ? expectOf(T) : null);
    for (;;) {
      const nx = nextCore(st, bank, rnd); if (!nx) break;
      const it = nx.item; st.items[it.id] = it;
      const s = stepOf(it.level, it.band);
      st.core.push({ id: it.id, step: s, ph: nx.ph });
      const p = s <= T ? 0.92 : s === T + 1 ? 0.45 : 0.25; // своё — почти всегда, выше — догадка
      st.answers[it.id] = { v: null, ok: rnd() < p };
    }
    res.push(coreResult(st, bank)); lens.push(st.core.length);
  }
  const hit = res.filter((r) => r === T).length / res.length, near = res.filter((r) => Math.abs(r - T) <= 1).length / res.length;
  console.log(`${STEPS[T].padEnd(4)} точно ${(hit * 100).toFixed(0)}%  ±1 ${(near * 100).toFixed(0)}%  заданий ${Math.min(...lens)}–${Math.max(...lens)} (в среднем ${(lens.reduce((a, b) => a + b, 0) / lens.length).toFixed(1)})`);
}
