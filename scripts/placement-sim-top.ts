// Проверка верхних уровней: доходит ли тест до заданий C1 у сильных учеников (B2, B2+, C1).
// npx tsx scripts/placement-sim-top.ts
import fs from "node:fs";
import { coreResult, emptyState, nextCore, stepOf, STEPS, type Bank, type CoreItem, type Group } from "../src/lib/placement/engine";

const dir = "content/placement/";
const groups = JSON.parse(fs.readFileSync(dir + "00_groups.json", "utf8")) as Group[];
const gOf = new Map(groups.flatMap((g) => g.topics.map((t) => [t, g.id] as const)));
const core = ["01_core_A1", "02_core_A2", "03_core_B1", "04_core_B2", "05_core_C1"].flatMap((f) => JSON.parse(fs.readFileSync(dir + f + ".json", "utf8"))) as CoreItem[];
for (const x of core) x.group = x.group ?? gOf.get(x.topic_id);
const families = JSON.parse(fs.readFileSync(dir + "00_families.json", "utf8"));
const bank: Bank = { groups, families, core, reading: [], listening: [], writing: [], speaking: [] };
let seed = 11; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
for (const T of [6, 7, 8]) for (const expect of [null, "B2"] as const) {
  let asked = 0, hit = 0, near = 0; const lens: number[] = [];
  for (let run = 0; run < 400; run++) {
    const st = emptyState(expect);
    for (;;) {
      const nx = nextCore(st, bank, rnd); if (!nx) break;
      const it = nx.item; st.items[it.id] = it; const s = stepOf(it.level, it.band);
      st.core.push({ id: it.id, step: s, ph: nx.ph });
      st.answers[it.id] = { v: null, ok: rnd() < (s <= T ? 0.92 : s === T + 1 ? 0.45 : 0.25) };
    }
    const r = coreResult(st, bank); if (r === T) hit++; if (Math.abs(r - T) <= 1) near++;
    if (st.core.some((x) => (st.items[x.id] as CoreItem).level === "C1")) asked++;
    lens.push(st.core.length);
  }
  console.log(`${STEPS[T].padEnd(4)} ${expect ? "ожидаемый B2" : "без ожидаемого"}: точно ${(hit / 4).toFixed(0)}% ±1 ${(near / 4).toFixed(0)}%  задания C1 были у ${(asked / 4).toFixed(0)}%  заданий ${Math.min(...lens)}–${Math.max(...lens)} (в среднем ${(lens.reduce((a, b) => a + b, 0) / lens.length).toFixed(0)})`);
}
