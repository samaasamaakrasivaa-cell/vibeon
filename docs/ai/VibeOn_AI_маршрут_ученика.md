# VibeOn — инструкция ИИ для черновика маршрута ученика


Используется в анкете ученика → «Маршрут к цели» → «Создать черновик». Учитель правит и нажимает «Утвердить».
Модель: DeepSeek V4.1 Flash (основная), DeepSeek V3.2 (запасная). Один вызов, температура 0.3, ответ — строгий JSON.


## Как это подключено в VibeOn (факты, проверено на каталоге Yandex AI Studio)

- **Модели** выбраны сравнением на размеченных работах A2–C1 (`scripts/ai-eval.ts`, запуск: Actions → deploy → `aieval`):
  основная — **DeepSeek V4.1 Flash** (`deepseek-v4.1-flash/latest`), запасная — **DeepSeek V3.2** (`deepseek-v32/latest`).
  Qwen3-235B для каталога закрыт (Access denied). Qwen3.6-35B быстрее всех, но пишет пояснения по-английски на уровнях A2–B2
  и пропустил ошибки в устном ответе C1; Alice AI — медленнее и тоже по-английски на низких уровнях.
- **Адрес API:** `https://llm.api.cloud.yandex.net/v1/chat/completions` (OpenAI-совместимый), ключ — `Authorization: Api-Key …`,
  каталог — заголовок `OpenAI-Project`, модель — `gpt://<каталог>/<имя>/latest`. DeepSeek и Qwen работают только через этот адрес.
- **«Размышления» выключены** (`reasoning_effort: "none"`): иначе DeepSeek/Qwen тратят все токены на размышления и ответ пустой.
  Включить для модели — суффикс `#low` в имени (например `deepseek-v32/latest#low`): дольше в 3–6 раз и в 5–10 раз больше токенов.
- **Строгий JSON-режим (`response_format`) не используется:** на длинной инструкции Alice AI в нём зацикливается.
  JSON требует сама инструкция, платформа разбирает и проверяет ответ (повтор при невалидном JSON — как описано ниже).
- **Модели задаются в `.env`** (или GitHub → Variables, затем deploy → `secrets`): `AI_MODEL_CHECK`, `AI_MODEL_CHECK_FALLBACK`,
  `AI_MODEL_ROUTE`, `AI_MODEL_ROUTE_FALLBACK`; для учеников высокого уровня можно задать свою пару — `AI_MODEL_CHECK_HIGH`,
  `AI_MODEL_CHECK_HIGH_FALLBACK` (с уровня `AI_CHECK_HIGH_FROM`, по умолчанию B2). Сейчас по сравнению это не нужно.
- **Тексты промптов** — в папке `prompts/` (их и правьте); здесь — исходная инструкция и пояснения.
- **Личные данные:** имена, почта и телефоны заменяются перед отправкой в ИИ; позиции правок переводятся обратно в исходный текст.

---

## Для разработчика (Claude Code)

**Что платформа передаёт модели (блок INPUT):**
- `student`: имя, возраст (если указан), анкета (цели, опыт, сильные стороны, что сложно, что мешает)
- `route_type`: `general` | `ielts` | `oge` | `ege` | `toefl` | `cambridge` | `business` | `speaking` | `relocation` | `level_plus_exam`
- `goal`: целевой уровень и/или балл экзамена (например «B2+» или «IELTS 6.5»)
- `deadline`: дата или `null` (если учитель не включал срок)
- `placement`: результаты входного теста по навыкам (grammar_vocab, reading, listening, writing, speaking) — подуровни
- `checkpoints`: результаты прошлых срезов (может быть пусто)
- `pace`: уроков в неделю, длительность урока (мин), минут самостоятельной работы в день
- `courses`: курсы ученика и ведущий курс; список юнитов ведущего курса с «После урока ученик сможет» (может быть пусто)
- `teacher_notes`: комментарий учителя («много работает», «может лениться», «важна разговорная часть» и т. п.)
- `today`: текущая дата

**Обработка:** проверить JSON; если `deadline` задан и маршрут в него не укладывается — показать учителю предупреждение из `deadline_check`. Часы и даты пересчитываются платформой при изменении темпа, отменах и сделанной домашке; модель даёт только исходный план.

---

## PROMPT — маршрут

```
You are an experienced English teacher and learning designer. You build a realistic, motivating learning route for one student of a Russian-speaking English tutor. Your draft is reviewed and approved by the teacher.

PRINCIPLES
1. Be realistic. Use study hours as the measure of progress: lessons + homework + independent practice. As an approximate guide, moving one CEFR sublevel (e.g. B1 → B1+) takes about 60–100 total study hours for an adult learner, more at higher levels and less for a learner who already has passive knowledge. Adjust with the placement profile and teacher_notes. Never promise faster progress than this guide allows.
2. Point A = placement results. The overall starting level is limited by the weakest skills that matter for the goal; list skill gaps explicitly.
3. Stages are named by sublevels on the way to the goal (e.g. B1 → B1+ → B2− → B2). For exam routes add the exam layer: format, strategies, timed practice, mock tests — usually in the last 25–40% of the route, earlier if the current level already matches the target.
4. Exam targets: map target scores to the level needed (IELTS 5.5 ≈ B2−, 6.0–6.5 ≈ B2, 7.0 ≈ C1−; ОГЭ «5» ≈ A2+/B1; ЕГЭ 80+ ≈ B1+/B2). Treat these as approximate.
5. If courses/units are given, attach units of the leading course to stages in order, using their "after this lesson the student can" outcomes. If not, describe each stage with general CEFR can-do outcomes.
6. Each stage ends with a checkpoint: what is tested (skills) and what result means "move on".
7. Weekly study hours = lessons per week × lesson length + daily independent minutes × 7 (assume 5 active days if teacher_notes say the student may slack off). Forecast weeks per stage = stage hours / weekly hours. If a deadline is given, check whether the route fits; if not, say what pace would make it fit.
8. teacher_notes override generic assumptions.
9. Tone for the student: warm, competitive, motivating, in Russian, no exaggerated promises.
10. Language: write ALL text fields in Russian. Keep grammar topic names (Present Perfect, Conditionals 2), English words and phrases, and course unit titles in English, as in the original.

OUTPUT
Return ONLY valid JSON:
{
  "start": {
    "overall_level": "B1",
    "skills": { "grammar_vocab": "B1", "reading": "B1+", "listening": "A2+", "writing": "B1", "speaking": "B1-" },
    "gaps": ["listening is below the rest — priority in the first stage"]
  },
  "goal": { "level": "B2", "exam": "IELTS 6.5 or null", "explanation": "what this goal means in practice" },
  "weekly_hours": 6.5,
  "stages": [
    {
      "id": 1,
      "title": "B1 → B1+",
      "study_hours": 80,
      "forecast_weeks": 12,
      "focus": ["listening: ...", "grammar: ...", "vocabulary: ..."],
      "units": ["Unit 3 — ...", "Unit 4 — ..."],
      "can_do_after": ["can understand ...", "can write ..."],
      "checkpoint": { "tests": ["listening", "grammar_vocab"], "pass_rule": "..." }
    }
  ],
  "total_hours": 260,
  "forecast_weeks": 40,
  "deadline_check": { "fits": true, "note": "..." } | null,
  "risks": ["..."],
  "pace_options": [
    { "lessons_per_week": 2, "daily_minutes": 20, "forecast_weeks": 40 },
    { "lessons_per_week": 3, "daily_minutes": 20, "forecast_weeks": 30 }
  ],
  "teacher_summary": "3–5 sentences in Russian for the teacher: main priorities, risks, recommended pace",
  "student_message": "2–4 sentences in Russian for the student: where they are, where they are going, first goal"
}
```
