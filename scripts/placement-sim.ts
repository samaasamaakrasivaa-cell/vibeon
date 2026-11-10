// Прогон «лесенки» вводного теста на виртуальных учениках: npx tsx scripts/placement-sim.ts
// Ученик уровня T отвечает верно с вероятностью, зависящей от ступени задания относительно T.
import fs from "node:fs";
import { checkText, coreResult, emptyState, nextStep, pickCore, stepOf, STEPS, type Bank, type CoreItem } from "../src/lib/placement/engine";

const dir = "content/placement/";
const core = ["01_core_A1", "02_core_A2", "03_core_B1", "04_core_B2", "05_core_C1"].flatMap((f) => JSON.parse(fs.readFileSync(dir + f + ".json", "utf8"))) as CoreItem[];
const bank: Bank = { core, reading: [], listening: [], writing: [], speaking: [] };
let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

const rows: string[] = [];
const MODE = process.argv[2] ?? "warm"; // warm | expect
const expectOf = (T: number) => (T <= 2 ? "A1" : T <= 5 ? "B1" : "B2") as "A1" | "B1" | "B2";
for (let T = 0; T <= 8; T++) {
  const res: number[] = [], lens: number[] = [];
  for (let run = 0; run < 400; run++) {
    const st = emptyState(MODE === "expect" ? expectOf(T) : null);
    for (;;) {
      const s = nextStep(st, bank); if (s === null) break;
      const it = pickCore(st, bank, s, rnd)!; if (!it) break;
      st.items[it.id] = it; st.core.push({ id: it.id, step: s });
      const p = s <= T ? 0.92 : s === T + 1 ? 0.45 : 0.25; // своё — почти всегда, выше — догадка
      st.answers[it.id] = { v: null, ok: rnd() < p };
    }
    res.push(coreResult(st, bank)); lens.push(st.core.length);
  }
  const hit = res.filter((r) => r === T).length / res.length, near = res.filter((r) => Math.abs(r - T) <= 1).length / res.length;
  rows.push(`${STEPS[T].padEnd(4)} точно ${(hit * 100).toFixed(0)}%  ±1 ${(near * 100).toFixed(0)}%  заданий ${Math.min(...lens)}–${Math.max(...lens)} (в среднем ${(lens.reduce((a, b) => a + b, 0) / lens.length).toFixed(1)})`);
}
console.log(rows.join("\n"));
// проверка ответов
const ok = [checkText("I don't", ["i do not"]), checkText("must've forgotten", ["must have forgotten"]), checkText("Wish I'd learnt.", ["wish i had learnt"]), checkText(" Saturday ", ["saturday"]), checkText("it’s", ["it is"])];
const bad = [checkText("dont", ["do not"]), checkText("had know", ["had known"])];
console.log("сравнение ответов:", ok.every(Boolean) && !bad.some(Boolean) ? "ок" : `ошибка ${ok} ${bad}`);
console.log("ступеней в банке:", STEPS.map((s, i) => `${s}:${core.filter((x) => stepOf(x.level, x.band) === i).length}`).join(" "));
