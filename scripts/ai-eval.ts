// Сравнение моделей для проверки работ (deploy → aieval). Тестовые работы с заранее размеченными ошибками на уровнях A2–C1;
// каждая модель проходит тот же конвейер, что на платформе (2 шага). Считается: найдено ошибок, верно исправлено, лишние правки,
// «ловушки» (правильные сложные конструкции, которые нельзя исправлять), язык пояснений по инструкции, время, токены.
import { readFileSync } from "node:fs";
import path from "node:path";
import { chat, studioChat, type LlmMsg, type LlmOpts } from "../src/lib/ai/providers";
import { SPECS } from "../src/lib/ai/tasks";
import { describe5, RUB_V2 } from "../src/lib/placement/rubric";
import { checkWith, type CheckInput, type CheckTaskType, type Edit } from "../src/lib/ai/check-core";

const P = (n: string) => readFileSync(path.join(process.cwd(), "prompts", `${n}.md`), "utf8").trim();
const prompts = { check: P("check-1"), review: P("check-2-review") };

type Gold = { frag: string; fix: RegExp; soft?: boolean };
type Case = { id: string; level: string; type: CheckTaskType; prompt: string; text: string; gold: Gold[]; traps: string[] };

const CASES: Case[] = [
  {
    id: "A2 текст", level: "A2", type: "essay", prompt: "Write about yourself and your week (60–80 words).",
    text: "My name is Pavel. I am 12 years. I live in Kazan with my mother and my sister. My sister have a cat. Every morning I go to school at 8 o'clock. I like English because it is interesting. Yesterday I play football with my friends. We was very happy. In the weekend I watching TV. I don't like cook.",
    gold: [
      { frag: "I am 12 years", fix: /12 years old|I am 12\b|I'm 12/i },
      { frag: "sister have", fix: /has/i },
      { frag: "Yesterday I play", fix: /played/i },
      { frag: "We was", fix: /were/i },
      { frag: "In the weekend", fix: /(at|on) the weekend|at weekends|on weekends/i },
      { frag: "I watching", fix: /I watch\b|I am watching|I'm watching|I usually watch/i },
      { frag: "like cook", fix: /cooking|to cook/i },
    ],
    traps: ["at 8 o'clock", "because it is interesting", "with my mother and my sister"],
  },
  {
    id: "B1 эссе", level: "B1", type: "essay", prompt: "Write an essay (150–180 words): Is it better to live in a city or in the countryside?",
    text: `Nowadays many people think that living in a big city is better than living in the countryside. In my opinion, both places has advantages and disadvantages.

First of all, in the city there is more opportunities for work and study. For example, my brother moved to Moscow two years ago and he find a good job very quickly. Also, there are a lot of cinemas, museums and cafes, so you never feel boring.

On the other hand, life in the countryside is more calm and healthy. The air is cleaner and people are more friendly than in the city. When I visited my grandmother last summer, I have felt very relaxed and I slept much better.

To sum up, I think that the city is good for young people who wants to make a career, but the countryside is better for families with children and old people. Personally I would like to live in the city now and move to the countryside when I will be older.`,
    gold: [
      { frag: "places has", fix: /have/i }, { frag: "there is more opportunities", fix: /there are/i }, { frag: "he find", fix: /found/i },
      { frag: "feel boring", fix: /bored/i }, { frag: "more calm", fix: /calmer/i }, { frag: "I have felt", fix: /I felt/i },
      { frag: "who wants", fix: /who want\b/i }, { frag: "when I will be", fix: /when I am|when I'm|when I get/i },
    ],
    traps: ["my brother moved to Moscow two years ago", "people are more friendly", "I slept much better"],
  },
  {
    id: "B1 устный", level: "B1", type: "speech_transcript", prompt: "Tell me about your last weekend.",
    text: "um so last weekend i go to the cinema with my friends and we watched a new film about space it was really interesting but a bit long uh i think the actors was very good and the music was amazing after the film we go to a cafe and eat pizza i really enjoy it because i didn't went out for a long time",
    gold: [
      { frag: "i go to the cinema", fix: /went/i }, { frag: "actors was", fix: /were/i }, { frag: "we go to a cafe", fix: /went/i },
      { frag: "and eat pizza", fix: /ate|had/i }, { frag: "i really enjoy it", fix: /enjoyed/i }, { frag: "didn't went", fix: /didn't go|hadn't gone|hadn't been|haven't been|haven't gone/i },
    ],
    traps: ["we watched a new film about space", "the music was amazing"],
  },
  {
    id: "B2 эссе", level: "B2", type: "essay", prompt: "Write an essay (220–260 words): Remote work — benefits and drawbacks.",
    text: `In recent years, remote work has become increasingly popular, and many companies are now offering their employees the possibility to work from home. Although this trend has clear benefits, it also raises a number of concerns.

On the one hand, working from home allows people to save a lot of time which they would otherwise spend on commuting. Moreover, employees who have children can organise their day more flexible. According to a recent survey, more than 60% of remote workers say they are more productive than in the office.

On the other hand, isolation can have a negative impact for mental health. Many people miss the informal conversations with their colleagues, and some find it difficult to separate work from their private life. If I would work from home every day, I would probably feel lonely after a while.

In conclusion, I believe that a hybrid model, in which employees spend two or three days in the office, is the most reasonable solution. It combines the advantages of both approaches and helps to avoid most of the disadvantages. Despite of this, every company should decide what suits it's employees best.`,
    gold: [
      { frag: "possibility to work", fix: /opportunity|option|possibility of working|chance to work/i, soft: true },
      { frag: "more flexible", fix: /flexibly/i }, { frag: "impact for", fix: /impact on/i }, { frag: "If I would work", fix: /If I worked|If I were to work|If I were working/i },
      { frag: "Despite of this", fix: /^despite this|in spite of this|despite this/i }, { frag: "it's employees", fix: /its employees/i },
    ],
    traps: ["organise", "On the one hand", "has become increasingly popular", "in which employees spend"],
  },
  {
    id: "C1 эссе", level: "C1", type: "essay", prompt: "Write an essay (250–300 words): Should governments strictly regulate artificial intelligence?",
    text: `Rarely have governments faced a challenge as complex as the regulation of artificial intelligence. While the technology promises unprecedented gains of productivity, it also threatens to exacerbate existing inequalities, a concern that policymakers can ill afford to ignore.

Proponents of strict regulation argue that, were AI systems left unchecked, they could entrench biases on a massive scale. This argument is not without merit: there have already been several high-profile cases in which algorithms discriminated job applicants on the basis of gender. Nevertheless, overly rigid rules risk to stifle innovation, particularly among smaller firms who lack the resources to comply with complex legislation.

In my view, the most sensible approach lies in between these two extremes. Rather than imposing blanket bans, regulators should focus on transparency, requiring companies to disclose how their models are trained and evaluated. Had such requirements been introduced earlier, many of the scandals of recent years might have been avoided. Ultimately, the success of any regulatory framework will depend on whether it can adapt as quick as the technology itself evolves, which, given the pace of change, is easier said than done.

It is also worth to mention that public trust plays a crucial role. Without it, even the most well-designed policy will struggle to gain acceptance, as citizens are unlikely to embrace systems they neither understand nor trust.`,
    gold: [
      { frag: "gains of productivity", fix: /gains in productivity|productivity gains/i }, { frag: "discriminated job applicants", fix: /discriminated against/i },
      { frag: "risk to stifle", fix: /risk stifling/i }, { frag: "as quick as", fix: /as quickly as/i }, { frag: "worth to mention", fix: /worth mentioning|worth noting/i },
      { frag: "firms who lack", fix: /firms that|firms which/i, soft: true }, { frag: "lies in between", fix: /lies between|lies somewhere (in )?between|lies in the middle/i, soft: true },
      { frag: "most well-designed", fix: /best-designed|best designed/i, soft: true },
    ],
    traps: ["Rarely have governments faced", "were AI systems left unchecked", "can ill afford to ignore", "is not without merit", "Had such requirements been introduced earlier", "neither understand nor trust", "easier said than done"],
  },
  {
    id: "C1 устный", level: "C1", type: "speech_transcript", prompt: "Why did you decide to move abroad? Would you do it again?",
    text: "well i'd say the main reason i decided to move abroad was the career opportunities to be honest back home i felt like i've hit a ceiling you know and the job market here is just much more dynamic that said it wasn't easy at first i had to get used to a completely different work culture people here are way more direct which took some getting used to if i had known how hard the first year would be i'm not sure i would make the same decision but looking back i don't regret it at all",
    gold: [{ frag: "i've hit a ceiling", fix: /i'd hit|i had hit/i }, { frag: "i would make the same decision", fix: /would have made/i }],
    traps: ["which took some getting used to", "way more direct", "that said", "looking back i don't regret it at all", "i'd say the main reason"],
  },
];

type Cfg = { name: string; model: string; reasoning?: string; maxTokens?: number };
const CFGS: Cfg[] = [
  { name: "DeepSeek V3.2", model: "deepseek-v32/latest" },
  { name: "DeepSeek V3.2 + размышления", model: "deepseek-v32/latest", reasoning: "low", maxTokens: 20000 },
  { name: "Qwen3.6-35B", model: "qwen3.6-35b-a3b/latest" },
  { name: "Qwen3.6-35B + размышления", model: "qwen3.6-35b-a3b/latest", reasoning: "low", maxTokens: 20000 },
  { name: "DeepSeek V4.1 Flash", model: "deepseek-v4.1-flash/latest" },
  { name: "Alice AI LLM", model: "aliceai-llm/latest" },
  { name: "Alice AI LLM Flash", model: "aliceai-llm-flash/latest" },
];

const cyr = (s: string) => { const l = s.replace(/[^\p{L}]/gu, ""); return l ? (l.match(/\p{Script=Cyrillic}/gu)?.length ?? 0) / l.length : 0; };
/** Язык пояснений по инструкции: до B1 и B1+–B2 — по-русски, B2+–C1 — по-английски. */
const wantRu = (lvl: string) => !/^(B2\+|C1)/.test(lvl);

async function runCase(cfg: Cfg, c: Case) {
  const llm = (m: string, msgs: LlmMsg[], o?: LlmOpts) => studioChat(m, msgs, { ...o, reasoning: cfg.reasoning, maxTokens: cfg.maxTokens ?? o?.maxTokens, timeoutMs: 300000 });
  const input: CheckInput = { task_type: c.type, level: c.level, exam: "none", exam_criteria: "", task_prompt: c.prompt, lesson_focus: "", teacher_notes: "", student_text: c.text };
  const t0 = Date.now();
  try {
    const r = await checkWith(llm, cfg.model, input, prompts);
    const ed = r.result.edits;
    const span = (frag: string) => { const a = c.text.toLowerCase().indexOf(frag.toLowerCase()); return a < 0 ? null : [a, a + frag.length] as const; };
    const hit = (e: Edit, s: readonly [number, number] | null) => !!s && e.start < s[1] && e.end > s[0];
    let found = 0, fixed = 0, hard = 0, softFound = 0;
    const used = new Set<number>();
    for (const g of c.gold) {
      const s = span(g.frag);
      const e = ed.find((x) => hit(x, s));
      if (!g.soft) hard++;
      if (e) { used.add(e.id); if (g.soft) softFound++; else { found++; if (g.fix.test(e.corrected)) fixed++; } }
    }
    const trapHits = ed.filter((e) => c.traps.some((t) => hit(e, span(t))) && !used.has(e.id));
    trapHits.forEach((e) => used.add(e.id));
    const extraErr = ed.filter((e) => !used.has(e.id) && e.type === "error");
    const extraImp = ed.filter((e) => !used.has(e.id) && e.type === "improvement");
    const ex = ed.map((e) => e.explanation).filter(Boolean);
    const ruShare = ex.length ? ex.filter((x) => cyr(x) > 0.3).length / ex.length : 0;
    const langOk = wantRu(c.level) ? ruShare >= 0.8 : ruShare <= 0.2;
    const commentRu = cyr(r.result.summary.comment_to_student) > 0.3;
    return {
      cfg: cfg.name, case: c.id, ok: true, found, fixed, hard, softFound, soft: c.gold.filter((g) => g.soft).length,
      trap: trapHits.length, extraErr: extraErr.length, extraImp: extraImp.length, langOk, ruShare: Math.round(ruShare * 100), commentRu,
      level: r.result.summary.estimated_level, ms: r.meta.ms, tin: r.meta.tokensIn, tout: r.meta.tokensOut, retries: r.meta.retries, dropped: r.meta.dropped,
      trapList: trapHits.map((e) => `${e.original}→${e.corrected}`), extraList: extraErr.map((e) => `${e.original}→${e.corrected}`),
    };
  } catch (e) {
    return { cfg: cfg.name, case: c.id, ok: false, error: String((e as Error).message).slice(0, 200), ms: Date.now() - t0 };
  }
}

(async () => {
  if (process.argv[2] === "placement") {
    for (const kind of ["writing", "speaking"] as const) {
      const input = { kind, level: "B1", below: "A2", max: 5,
        task: kind === "writing" ? CASES[1].prompt : "Where did you go last weekend? Would you recommend it and why?",
        answers: kind === "writing" ? [CASES[1].text] : ["Last weekend I go to the cinema with my friends and the actors was excellent.", "I would recommend the film because the plot kept me guessing."],
        criteria: RUB_V2[kind].map((c) => ({ id: c.id, name: c.name_ru, level: "B1", below: "A2", bands: [5,4,3,2,1,0].map((n) => `${n} — ${describe5(c, "B1", n)}`) })) };
      const spec = SPECS.plscore;
      const res = await chat({ system: spec.system(input), messages: spec.user(input), strong: spec.strong, maxTokens: spec.maxTokens, json: true, temperature: spec.temperature });
      const score = spec.parse(res.text, input);
      if (!score.edits?.length || (kind === "speaking" && score.scores.pronunciation !== null)) throw new Error(`Incomplete ${kind} evaluation`);
      console.log(`Placement ${kind}: ${Object.keys(score.why).length} evidenced criteria, ${score.edits.length} anchored corrections, ${score.unplaced} unmatched (${res.model})`);
    }
    return;
  }
  const only = (process.argv[2] || "").split(",").filter(Boolean);
  const cfgs = only.length ? CFGS.filter((c) => only.some((o) => c.name.includes(o) || c.model.includes(o))) : CFGS;
  console.log(`EVAL configs: ${cfgs.map((c) => c.name).join(" | ")}`);
  // модели — параллельно, работы у одной модели — по очереди
  await Promise.all(cfgs.map(async (cfg) => {
    for (const c of CASES) {
      const r = await runCase(cfg, c);
      console.log("RES " + JSON.stringify(r));
    }
  }));
  console.log("EVAL done");
})();
