// Проба маршрута v2 на сервере: синтетическая ученица B2+ (не данные платформы) → вывод → маршрут → подсказки к точке → правка.
import { mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import path from "node:path";
import { studioChat } from "../src/lib/ai/providers";
import { modelsFor, modelLabel } from "../src/lib/ai/models";
import { cleanArticle, cleanInsight, cleanRecs, cleanRoute, compactStages, runJson, settleHours, toStages } from "../src/lib/ai/route-core";
import { hoursTo } from "../src/lib/roadmap/cefr";

const OUT = "/tmp/aiout";
const P = (n: string) => readFileSync(path.join(process.cwd(), "prompts", `${n}.md`), "utf8");
const llm = (m: string, msgs: Parameters<typeof studioChat>[1], o?: Parameters<typeof studioChat>[2]) => studioChat(m, msgs, o);

const pack = {
  date: "2026-11-20", level: "B2+",
  skills: [{ name: "Грамматика", step: "B2", pct: 66 }, { name: "Лексика", step: "B2+", pct: 78 }, { name: "Чтение", step: "C1", pct: 83 }, { name: "Аудирование", step: "B2+", pct: 80 }, { name: "Письмо", step: "C1", pct: 67 }, { name: "Говорение", step: "C1", pct: 67 }],
  grammarTopics: [
    { name: "Артикли: абстрактные существительные, институты, география", level: "B2", c: 1, n: 5, verdict: "gap" },
    { name: "Инверсия: Had I known / Should you", level: "C1", c: 0, n: 2, verdict: "gap" },
    { name: "Смешанные условные предложения", level: "B2", c: 1, n: 3, verdict: "gap" },
    { name: "Причастные обороты", level: "B2", c: 1, n: 3, verdict: "part" },
    { name: "Связи цели и результата (so as to, in order that)", level: "B2", c: 1, n: 2, verdict: "part" },
    { name: "Будущее в прошлом (was about to / would)", level: "C1", c: 1, n: 2, verdict: "part" },
    { name: "Модальные глаголы в прошлом", level: "B2", c: 3, n: 3, verdict: "own" },
    { name: "Пассив с модальными и перфектом", level: "B2", c: 3, n: 3, verdict: "own" },
  ],
  grammarErrors: [
    { topic: "Артикли: абстрактные существительные, институты, география", items: [{ q: "___ Amazon flows through Brazil.", given: "—", right: "The" }, { q: "She values ___ honesty above all.", given: "the", right: "—" }, { q: "He was sent to ___ prison for fraud.", given: "the", right: "—" }, { q: "We hiked in ___ Alps.", given: "—", right: "the" }] },
    { topic: "Инверсия", items: [{ q: "___ I known, I would have come.", given: "If", right: "Had" }, { q: "___ you need help, call me.", given: "If", right: "Should" }] },
    { topic: "Смешанные условные предложения", items: [{ q: "If I had taken that job, I ___ in London now.", given: "would have lived", right: "would live" }] },
  ],
  vocabErrors: [{ topic: "Коллокации C1", items: [{ q: "to ___ a decision", given: "do", right: "make / reach" }] }],
  writing: { level: "C1", marks: [{ name: "Решение задачи", v: 3, note: "" }, { name: "Связность", v: 2, note: "" }, { name: "Лексика", v: 2, note: "мало идиоматичных выражений" }, { name: "Грамматика", v: 1, note: "артикли с абстрактными существительными, have/has" }], note: "Хорошая структура, но ошибки в артиклях и согласовании." },
  speaking: { level: "C1", marks: [{ name: "Беглость", v: 2, note: "" }, { name: "Лексика", v: 2, note: "" }, { name: "Грамматика", v: 1, note: "нет инверсии и смешанных условных" }, { name: "Произношение", v: 3, note: "" }], note: "Говорит бегло, но упрощает грамматику." },
  report: { strong: "Чтение C1, беглая речь, хорошая структура письма.", work: "Артикли, инверсия, смешанные условные; лексика для переговоров.", plan: "1) Артикли. 2) Инверсия и условные. 3) Лексика для переговоров и презентаций.", comment: "Главное — закрыть пробелы в артиклях и продвинутой грамматике." },
};
const base = {
  pack, account: { lessons: { total: 2, last4w: 2, hours4w: 2 }, homework: { assigned8w: 2, done8w: 2 }, minutesPerWeek: [0, 0, 40, 65], tests: [{ date: "2026-11-20", kind: "entry", level: "B2+" }] },
  student: { age: 29, form: { goal: "Уверенный английский для работы", job: "Маркетолог в IT-компании" } },
  route: { type: "general", goal: "C1+", goal_level: "C1+", from_level: "B2+", deadline: null, weeks_until_deadline: null, pace: { lessons_per_week: 2, lesson_minutes: 60, daily_minutes: 20, active_days: 7 }, teacher_notes: "" },
  hours_guide: { "B2+ → C1": 100, "C1 → C1+": 120 }, courses: null,
  self_study_budget: { minutes_per_week: 150, lessons_per_week: 2, lesson_minutes: 60, active_days: 7 },
};
const brief = {
  goal: "С B2+ быстро закрыть пробелы и выйти на уверенный C1, затем C1+. Цель — переговоры и презентации на работе без грамматических ошибок.",
  interests: "психология, путешествия, подкасты", materials: "Журнал Happyful — статьи о психологии и благополучии", priorities: "говорение и письмо важнее всего",
  marks: { speaking: "strong", grammar: "weak" }, order: ["speaking", "writing", "grammar"],
};

export async function run() {
  rmSync(OUT, { recursive: true, force: true }); mkdirSync(OUT, { recursive: true });
  const models = modelsFor("route");
  const weekly = (2 * 60 + 20 * 7) / 60;
  let t0 = Date.now();
  const ins = await runJson(llm, models, P("route-insight"), { ...base, brief: {} }, cleanInsight, { tag: "insight", maxTokens: 5000, temperature: 0.2 });
  console.log(`INSIGHT ${modelLabel(ins.model)} · ${Math.round((Date.now() - t0) / 1000)} s · tokens ${ins.tokensIn}/${ins.tokensOut}`);
  console.log("INSIGHT " + JSON.stringify(ins.data));
  t0 = Date.now();
  const input = { ...base, brief, insight: { summary: ins.data.summary, blockers: ins.data.blockers, gaps: ins.data.gaps } };
  const rt = await runJson(llm, models, P("route"), { ...input, insight: { ...input.insight, confirmed_by_teacher: true, teacher_additions: "В разговоре делает больше ошибок, чем показал тест." } }, (j) => cleanRoute(j, 150), { tag: "route", maxTokens: 9000, timeoutMs: 280000 });
  const d = settleHours(rt.data, weekly, hoursTo);
  console.log(`ROUTE ${modelLabel(rt.model)} · ${Math.round((Date.now() - t0) / 1000)} s · tokens ${rt.tokensIn}/${rt.tokensOut} · retries ${rt.retries}`);
  for (const s of d.segments) { console.log(`SEG ${s.title} [${s.kind}] ${s.hours} h · ${s.weeks} wk`); for (const p of s.points) console.log(`  · ${p.title} (${p.level}) ${p.hours} h — ${p.focus}`); }
  console.log(`TOTAL ${d.total_hours} h · ${d.forecast_weeks} wk`);
  for (const s of d.segments) for (const p of s.points) console.log(`  hours_why: ${p.title} — ${p.hours_why}`);
  console.log("SELF " + JSON.stringify(d.self_study));
  const stages = toStages(d, "C1+");
  t0 = Date.now();
  const p0 = stages[0].points[0];
  const recs = await runJson(llm, models, P("route-point"), { point: { title: p0.title, level: p0.level, why: p0.why, focus: p0.focus }, student: { level: "B2+", goal: "C1+", interests: brief.interests }, materials: brief.materials, already_approved: {} }, cleanRecs, { tag: "point", maxTokens: 2500 });
  console.log(`POINT ${Math.round((Date.now() - t0) / 1000)} s · ` + JSON.stringify(recs.data));
  console.log("THEMES " + JSON.stringify(recs.data.themes));
  t0 = Date.now();
  const artText = "Perfectionism is often seen as a positive trait. Many of us take pride in setting high standards, and we tend to believe that the harder we push ourselves, the more successful we will be. Yet research suggests that perfectionism can take its toll on our wellbeing. Had I known this earlier, I would have stopped beating myself up over small mistakes. Perfectionists often burn out because they cannot switch off; they keep going over every detail and find it hard to let go. The key, psychologists say, is to aim for excellence rather than perfection: to set realistic goals, celebrate progress and accept that, at the end of the day, nobody is flawless. Self-compassion is not the same as giving up — it is what allows us to bounce back after setbacks.";
  const art = await runJson(llm, models, P("route-article"), { point: { title: p0.title, level: p0.level }, student: { level: "B2+", goal: "C1+", interests: brief.interests }, article: { title: "Perfectionism", text: artText } }, cleanArticle, { tag: "article", maxTokens: 3000 });
  console.log(`ARTICLE ${Math.round((Date.now() - t0) / 1000)} s · ` + JSON.stringify(art.data));
  t0 = Date.now();
  const ref = await runJson(llm, models, P("route"), { ...input, current_route: compactStages(stages), teacher_request: "Добавь отдельную точку на говорение для переговоров, а инверсию поставь после условных." }, (j) => cleanRoute(j, 150), { tag: "refine", maxTokens: 9000, timeoutMs: 280000 });
  const d2 = settleHours(ref.data, weekly, hoursTo);
  console.log(`REFINE ${Math.round((Date.now() - t0) / 1000)} s · changes: ${d2.changes}`);
  for (const s of d2.segments) { console.log(`SEG2 ${s.title} ${s.hours} h`); for (const p of s.points) console.log(`  · ${p.title} ${p.hours} h`); }
  writeFileSync(path.join(OUT, "route-probe.json"), JSON.stringify({ insight: ins.data, route: d, recs: recs.data, refined: d2 }, null, 1));
}
