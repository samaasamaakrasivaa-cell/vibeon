// Демо ИИ на сервере (deploy → aidemo): тестовое эссе B1 — проверка DeepSeek V3.2 и Alice AI (2 шага), черновик маршрута тестового ученика.
// Те же функции, что в платформе; данные платформы не читаются — только тестовые примеры ниже.
import { readFileSync } from "node:fs";
import path from "node:path";
import { studioChat } from "../src/lib/ai/providers";
import { checkWith, type CheckInput } from "../src/lib/ai/check-core";
import { runRoute, toStages, type RouteInput } from "../src/lib/ai/route-core";
import { modelsFor, modelLabel } from "../src/lib/ai/models";

const P = (n: string) => readFileSync(path.join(process.cwd(), "prompts", `${n}.md`), "utf8").trim();
const llm = (m: string, msgs: Parameters<typeof studioChat>[1], o?: Parameters<typeof studioChat>[2]) => studioChat(m, msgs, o);

const ESSAY = `Nowadays many people think that living in a big city is better than living in the countryside. In my opinion, both places has advantages and disadvantages.

First of all, in the city there is more opportunities for work and study. For example, my brother moved to Moscow two years ago and he find a good job very quickly. Also, there are a lot of cinemas, museums and cafes, so you never feel boring.

On the other hand, life in the countryside is more calm and healthy. The air is cleaner and people are more friendly than in the city. When I visited my grandmother last summer, I have felt very relaxed and I slept much better.

To sum up, I think that the city is good for young people who wants to make a career, but the countryside is better for families with children and old people. Personally I would like to live in the city now and move to the countryside when I will be older.`;

const check: CheckInput = {
  task_type: "essay", level: "B1", exam: "none", exam_criteria: "",
  task_prompt: "Write an essay (150–180 words): Is it better to live in a city or in the countryside?",
  lesson_focus: "Vocabulary: advantages and disadvantages, opportunities, to sum up, on the other hand. Grammar: Present Perfect vs Past Simple, future time clauses (when + present).",
  teacher_notes: "Сейчас отрабатываем Present Perfect vs Past Simple и придаточные времени (when + Present Simple).",
  student_text: ESSAY,
};

const route: RouteInput = {
  student: { age: 24, form: { goal: "Хочу свободно говорить на работе и пройти собеседование в международную компанию", experience: "Учила английский в школе и университете, потом перерыв 3 года", strengths: "Читаю статьи по работе", difficulties: "Плохо понимаю на слух, боюсь говорить" } },
  route_type: "general", goal: "B2", deadline: "2027-09", weeks_until_deadline: Math.round((Date.UTC(2027, 8, 1) - Date.now()) / (7 * 864e5)),
  placement: { overall_level: "B1", skills: { grammar: 68, vocabulary: 72, reading: 74, listening: 52, writing: 63, speaking: 55 }, weak: ["Present Perfect vs Past Simple", "Conditionals 2", "Listening: natural speed"], date: "2026-11-20" },
  checkpoints: [],
  pace: { lessons_per_week: 2, lesson_minutes: 60, daily_minutes: 20 },
  courses: { leading: "Speakout B1+", others: [], units: [
    { title: "Unit 1. Identity", outcomes: ["talk about personal experiences", "use question forms"] },
    { title: "Unit 2. Tales", outcomes: ["tell a story using narrative tenses"] },
    { title: "Unit 3. Contact", outcomes: ["make arrangements", "use future forms"] },
    { title: "Unit 4. Jobs", outcomes: ["talk about job preferences", "use used to / would"] },
  ] },
  teacher_notes: "Важна разговорная часть. Много работает, на домашку времени мало.",
  today: new Date().toISOString().slice(0, 10),
};

/** Диагностика: сырой ответ модели на шаге 1 с разными параметрами (причина остановки, токены, «размышления», начало ответа). */
async function raw(model: string, tag: string, extra: Record<string, unknown>) {
  const { inputBlock } = await import("../src/lib/ai/check-core");
  const folder = process.env.YANDEX_CLOUD_FOLDER_ID || "", key = process.env.YANDEX_CLOUD_API_KEY || "";
  const t0 = Date.now();
  try {
    const r = await fetch("https://llm.api.cloud.yandex.net/v1/chat/completions", { method: "POST", signal: AbortSignal.timeout(240000), headers: { Authorization: `Api-Key ${key}`, "OpenAI-Project": folder, "Content-Type": "application/json" }, body: JSON.stringify({ model: `gpt://${folder}/${model}`, temperature: 0.2, max_tokens: 6000, messages: [{ role: "system", content: P("check-1") }, { role: "user", content: inputBlock(check) }], ...extra }) });
    const b = await r.text();
    const j = JSON.parse(b); const c = j.choices?.[0]?.message?.content ?? "";
    let valid = false; try { const a2 = c.indexOf("{"), b2 = c.lastIndexOf("}"); JSON.parse(c.slice(a2, b2 + 1)); valid = true; } catch {}
    console.log(`RAW ${model} [${tag}] HTTP ${r.status} · ${Math.round((Date.now() - t0) / 1000)} s · finish=${j.choices?.[0]?.finish_reason} · out=${j.usage?.completion_tokens} reasoning=${j.usage?.completion_tokens_details?.reasoning_tokens ?? 0} · len=${c.length} · JSON ${valid ? "OK" : "BAD"} · ${r.ok ? JSON.stringify(c.slice(0, 160)) : b.slice(0, 200)}`);
  } catch (e) { console.log(`RAW ${model} [${tag}] fail ${(e as Error).message} · ${Math.round((Date.now() - t0) / 1000)} s`); }
}

(async () => {
  if (process.argv[2] === "tts") { const m = await import("./ai-tts"); await m.run(); return; }
  if (process.argv[2] === "probe2details") { process.argv[3] = "details"; const m = await import("./ai-probe2"); await m.run(); return; }
  if (process.argv[2] === "probe2") { const m = await import("./ai-probe2"); await m.run(); return; }
  if (process.argv[2] === "raw") {
    const ds = "deepseek-v32/latest", al = "aliceai-llm/latest";
    await Promise.all([
      raw(ds, "plain", {}), raw(ds, "effort=low", { reasoning_effort: "low" }), raw(ds, "effort=none", { reasoning_effort: "none" }),
      raw(ds, "thinking=false", { chat_template_kwargs: { thinking: false } }), raw(ds, "reasoning.effort=low", { reasoning: { effort: "low" } }),
      raw(al, "plain", {}), raw(al, "json_object", { response_format: { type: "json_object" } }),
    ]);
    return;
  }
  // node ai-demo.js models:a,b — сравнить другие модели (без маршрута)
  const only = (process.argv[2] || "").startsWith("models:") ? process.argv[2].slice(7).split(",") : null;
  const models = only ?? modelsFor("check");
  console.log(`DEMO models: ${models.join(", ")}`);
  const runs = await Promise.allSettled(models.map((m) => checkWith(llm, m, check, { check: P("check-1"), review: P("check-2-review") })));
  runs.forEach((r, i) => {
    console.log(`\n=== ESSAY ${modelLabel(models[i])} ===`);
    if (r.status === "rejected") { console.log("FAILED:", String(r.reason?.message ?? r.reason).slice(0, 400)); return; }
    const { result, meta } = r.value;
    console.log(`meta: ${Math.round(meta.ms / 1000)} s · tokens ${meta.tokensIn}/${meta.tokensOut} · retries ${meta.retries} · dropped ${meta.dropped} · self-check ${meta.selfCheck}`);
    for (const e of result.edits) console.log(`EDIT ${e.id} [${e.type}/${e.category}/${e.severity}] «${e.original}» → «${e.corrected}» — ${e.explanation}`);
    console.log("SUMMARY " + JSON.stringify(result.summary));
    console.log("CORRECTED " + JSON.stringify(result.corrected_text));
  });
  if (only) return;
  console.log("\n=== ROUTE ===");
  try {
    const r = await runRoute(llm, modelsFor("route"), route, P("route"));
    console.log(`meta: ${modelLabel(r.model)} · ${Math.round(r.ms / 1000)} s · tokens ${r.tokensIn}/${r.tokensOut} · retries ${r.retries}${r.fallbackFrom ? ` · fallback from ${r.fallbackFrom}` : ""}`);
    console.log("ROUTE " + JSON.stringify(r.draft));
    console.log("STAGES " + JSON.stringify(toStages(r.draft, "B2")));
  } catch (e) { console.log("ROUTE FAILED:", String((e as Error).message).slice(0, 400)); }
})();
