#!/usr/bin/env python3
"""Проверка банка вводного теста (content/placement/*.json).

Запуск: python3 -I scripts/check-placement-bank.py [файлы…]
Без аргументов проверяет все файлы банка. Печатает ошибки (ломают тест) и замечания (стоит посмотреть).
"""
import collections, glob, json, os, re, sys

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "content", "placement")
LEVELS = ["A1", "A2", "B1", "B2", "C1"]
TYPES = {"mcq", "gap", "wordform", "transform", "reading", "listening", "writing", "speaking"}
SKILL_OF_PREFIX = {"G": "grammar", "V": "vocabulary", "R": "reading", "L": "listening", "W": "writing", "S": "speaking"}
WORDS = {"reading": {"A1": (40, 60), "A2": (80, 110), "B1": (130, 170), "B2": (190, 240), "C1": (240, 300)}}
# слова грамматических терминов и местоимения — в разборе уместны, даже если их нет в задании
GRAMMAR_WORDS = set("""s the a an be to ing ed present past future simple continuous perfect progressive passive
he she it they we you i me him her us them his its their our my your conditional first second third zero mixed
modal verb verbs noun nouns adjective adverb adverbs phrasal phrase infinitive gerund participle clause clauses
article articles reported speech question questions negative positive plural singular uncountable countable
there is are was were do does did have has had will would can could may might must should shall""".split())
APOS = str.maketrans({"’": "'", "‘": "'", "“": '"', "”": '"'})

topics = {t["topic_id"]: t for t in json.load(open(os.path.join(ROOT, "00_topics.json")))}
errors, notes = [], []
err = lambda i, m: errors.append(f"{i}: {m}")
note = lambda i, m: notes.append(f"{i}: {m}")


def norm(s):
    s = s.translate(APOS).strip().lower()
    s = re.sub(r"\s+", " ", s)
    return re.sub(r"[.,!?]+$", "", s)


def latin_words(s):
    return {w.lower() for w in re.findall(r"[A-Za-z][A-Za-z']+", s or "")}


def check_topic(i, it):
    t = topics.get(it.get("topic_id"))
    if not t:
        return err(i, f"topic_id «{it.get('topic_id')}» нет в 00_topics.json")
    if t["skill"] != it.get("skill") or (t["level"] and t["level"] != it.get("level")):
        err(i, f"topic_id {t['topic_id']} — это {t['skill']} {t['level']}, а задание {it.get('skill')} {it.get('level')}")
    if it.get("topic_en") and it["topic_en"] != t["topic_en"]:
        note(i, f"topic_en отличается от каталога: «{it['topic_en']}» ≠ «{t['topic_en']}»")


def check_choice(i, q, options, answer):
    if not isinstance(options, list) or len(options) != 4:
        err(i, f"нужно 4 варианта, а их {len(options) if isinstance(options, list) else '—'}")
        return
    if len({norm(o) for o in options}) != 4:
        err(i, "варианты повторяются")
    if not isinstance(answer, int) or not 0 <= answer < 4:
        err(i, f"answer={answer} — вне 0…3")


def check_explain(i, it, text_pool):
    """Английские слова из разбора, которых нет ни в задании, ни в вариантах, — признак разбора «от другого вопроса»."""
    ex = it.get("explain_ru", "")
    if not ex:
        return err(i, "нет explain_ru")
    stem = lambda w: re.sub(r"(ing|ed|es|s)$", "", w)
    pool = {stem(w) for w in latin_words(text_pool)}
    stray = {w for w in latin_words(ex) - GRAMMAR_WORDS if stem(w) not in pool}
    if stray:
        note(i, f"в разборе слова, которых нет в задании: {', '.join(sorted(stray))} — разбор может быть от другого вопроса")


def check_item(it, seen):
    i = it.get("id", "?")
    if i in seen:
        err(i, "повтор id")
    seen.add(i)
    m = re.match(r"^([GVRLWS])-(A1|A2|B1|B2|C1)-\d{2}$", i)
    if not m:
        return err(i, "id не по формату X-B1-01")
    if SKILL_OF_PREFIX[m.group(1)] != it.get("skill"):
        err(i, f"по id это {SKILL_OF_PREFIX[m.group(1)]}, а skill={it.get('skill')}")
    if m.group(2) != it.get("level"):
        err(i, f"уровень в id {m.group(2)} ≠ level {it.get('level')}")
    if it.get("band") not in (1, 2, 3):
        err(i, f"band={it.get('band')}")
    ty = it.get("type")
    if ty not in TYPES:
        return err(i, f"неизвестный type «{ty}»")

    if ty in ("mcq", "gap", "wordform", "transform"):
        check_topic(i, it)
        q = it.get("q", "")
        if ty != "transform" and q.count("___") != 1:
            err(i, f"в вопросе должен быть ровно один пропуск ___ (сейчас {q.count('___')})")
        if ty == "mcq":
            check_choice(i, q, it.get("options"), it.get("answer"))
            check_explain(i, it, q + " " + " ".join(it.get("options", [])))
        else:
            acc = it.get("accept") or []
            if not acc:
                err(i, "пустой accept")
            for a in acc:
                if a != a.lower():
                    note(i, f"accept «{a}» не в нижнем регистре (сравнение всё равно без регистра)")
            if ty == "gap":
                one = [a for a in acc if len(norm(a).split()) == 1]
                if not one:
                    err(i, "в gap нет однословного варианта ответа")
            if ty == "wordform" and not it.get("base"):
                err(i, "нет base")
            if ty == "transform":
                if not it.get("key") or "___" not in it.get("frame", ""):
                    err(i, "у transform нужны key и frame с ___")
                for a in acc:
                    n = len(norm(a).split())
                    if not 2 <= n <= 5:
                        err(i, f"ответ «{a}» — {n} слов, нужно 2–5")
                    if it.get("key") and it["key"].lower() not in norm(a).split():
                        err(i, f"ответ «{a}» без ключевого слова {it['key']}")
            check_explain(i, it, q + " " + " ".join(acc) + " " + it.get("base", "") + " " + it.get("frame", ""))

    elif ty in ("reading", "listening"):
        body = it.get("passage") if ty == "reading" else it.get("script")
        if not body:
            err(i, "нет текста" if ty == "reading" else "нет сценария")
        n = len(re.findall(r"[A-Za-z']+", re.sub(r"\[pause[^\]]*\]|^[A-Z]:", " ", body or "", flags=re.M)))
        lo, hi = WORDS.get(ty, {}).get(it.get("level"), (0, 10**6))
        if ty == "reading" and not lo * 0.85 <= n <= hi * 1.15:
            note(i, f"в тексте {n} слов, для {it.get('level')} ожидается {lo}–{hi}")
        if ty == "listening":
            if any(s.get("accent") not in ("British", "American") for s in it.get("speakers", [])):
                err(i, "accent только British или American")
            names = {s.get("name") for s in it.get("speakers", [])}
            used = set(re.findall(r"^([A-Z][\w]*):", body or "", flags=re.M))
            if used - names:
                err(i, f"в сценарии реплики {', '.join(sorted(used - names))}, которых нет в speakers")
        for k, qq in enumerate(it.get("questions", []), 1):
            qi = qq.get("id", f"{i}-q{k}")
            if qq.get("id") != f"{i}-q{k}":
                err(qi, f"id вопроса должен быть {i}-q{k}")
            check_choice(qi, qq.get("q", ""), qq.get("options"), qq.get("answer"))
            t = topics.get(qq.get("topic_id"))
            if not t:
                err(qi, f"topic_id «{qq.get('topic_id')}» нет в каталоге")
            elif t["skill"] != ty:
                err(qi, f"topic_id {t['topic_id']} — тема {t['skill']}, а вопрос {ty}")
            if not qq.get("explain_ru"):
                err(qi, "нет explain_ru")
        if not it.get("questions"):
            err(i, "нет вопросов")

    elif ty == "writing":
        for k in ("prompt_en", "min_words", "max_words", "expects"):
            if not it.get(k):
                err(i, f"нет {k}")
    elif ty == "speaking":
        if not it.get("questions"):
            err(i, "нет вопросов")
        for qq in it.get("questions", []):
            if not qq.get("q") or not qq.get("speak_sec"):
                err(i, "у вопроса говорения нужны q и speak_sec")


def check_file(path):
    data = json.load(open(path))
    items = data if isinstance(data, list) else []
    if not isinstance(data, list):
        print(f"{os.path.basename(path)}: не массив — пропускаю")
        return
    seen = set()
    for it in items:
        check_item(it, seen)
    # сводка
    by = collections.Counter((it.get("skill"), it.get("type")) for it in items)
    bands = collections.Counter(it.get("band") for it in items)
    ans = collections.Counter(it.get("answer") for it in items if it.get("type") == "mcq")
    for it in items:
        for qq in it.get("questions", []) or []:
            if "answer" in qq:
                ans[qq["answer"]] += 1
    topic_use = collections.Counter(it.get("topic_id") for it in items if it.get("topic_id"))
    for t, n in topic_use.items():
        if n > 3:
            note(t, f"тема встречается {n} раз (правило — не больше 3)")
    qs = collections.Counter(norm(it.get("q", "")) for it in items if it.get("q"))
    for q, n in qs.items():
        if n > 1:
            err("—", f"одинаковый вопрос {n} раза: «{q[:60]}»")
    print(f"\n=== {os.path.basename(path)}: {len(items)} заданий")
    print("  по типам:", ", ".join(f"{s}/{t}: {n}" for (s, t), n in sorted(by.items())))
    print("  band:", dict(sorted(bands.items())), " позиции правильных ответов:", dict(sorted(ans.items())))
    return items


files = sys.argv[1:] or sorted(f for f in glob.glob(os.path.join(ROOT, "*.json")) if not os.path.basename(f).startswith("00_"))
for f in files:
    check_file(f)
print(f"\nОШИБКИ ({len(errors)}):")
for e in errors:
    print("  ✗", e)
print(f"ЗАМЕЧАНИЯ ({len(notes)}):")
for n in notes:
    print("  •", n)
sys.exit(1 if errors else 0)
