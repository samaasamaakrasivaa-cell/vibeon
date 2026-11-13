// Каталог типов заданий конструктора (по прототипу lesson-builder.html и Разметка_заданий.md).

export type TaskType =
  | "image" | "video" | "audio" | "text" | "wordset" | "vocab" | "note" | "link" | "divider"
  | "gap" | "drag" | "dropdown" | "test" | "tf" | "pairs" | "columns" | "picture"
  | "sentence" | "textorder" | "letters" | "essay" | "open" | "record" | "speak"
  | "errors" | "mark" | "transform" | "translate" | "dictation" | "crossword";

export const GROUPS: [string, string, string][] = [
  ["media", "Materials", "Материалы"],
  ["gaps", "Gaps", "Пропуски"],
  ["choice", "Choose the answer", "Выбор ответа"],
  ["match", "Match and sort", "Сопоставление и сортировка"],
  ["order", "Put in order", "Порядок"],
  ["prod", "Writing and speaking", "Письмо и речь"],
  ["extra", "New in VibeOn", "Новое в VibeOn"],
];

type Def = { g: string; en: string; ru: string; checkable?: boolean; teacherCheck?: boolean };
export const TYPES: Record<TaskType, Def> = {
  image: { g: "media", en: "Image", ru: "Изображение" },
  video: { g: "media", en: "Video", ru: "Видео" },
  audio: { g: "media", en: "Audio", ru: "Аудио" },
  text: { g: "media", en: "Text", ru: "Текст" },
  wordset: { g: "media", en: "Word set", ru: "Набор слов" },
  vocab: { g: "media", en: "Useful vocabulary", ru: "Useful vocabulary (рамка со словами)" },
  note: { g: "media", en: "Note", ru: "Заметка" },
  link: { g: "media", en: "Link", ru: "Ссылка" },
  divider: { g: "tech", en: "Divider", ru: "Разделитель" },
  gap: { g: "gaps", en: "Fill in the gaps", ru: "Заполни пропуски", checkable: true },
  drag: { g: "tech", en: "Fill in the gaps", ru: "Заполни пропуски", checkable: true }, // = gap с перетаскиванием
  dropdown: { g: "gaps", en: "Choose from a list", ru: "Выбрать из списка", checkable: true },
  test: { g: "choice", en: "Test", ru: "Тест", checkable: true },
  tf: { g: "choice", en: "True / False", ru: "Истина / ложь", checkable: true },
  pairs: { g: "match", en: "Match pairs", ru: "Сопоставить пары", checkable: true },
  columns: { g: "match", en: "Sort into columns", ru: "Распределить по колонкам", checkable: true },
  picture: { g: "match", en: "Word to picture", ru: "Слово к картинке", checkable: true },
  sentence: { g: "order", en: "Sentence from words", ru: "Предложение из слов", checkable: true },
  textorder: { g: "order", en: "Put the text in order", ru: "Текст по порядку", checkable: true },
  letters: { g: "order", en: "Word from letters", ru: "Слово из букв", checkable: true },
  essay: { g: "prod", en: "Essay", ru: "Сочинение", teacherCheck: true },
  open: { g: "prod", en: "Open answer", ru: "Открытый ответ", teacherCheck: true },
  record: { g: "prod", en: "Record audio", ru: "Запись аудио", teacherCheck: true },
  speak: { g: "prod", en: "Speaking", ru: "Говорение" },
  errors: { g: "extra", en: "Find and fix the mistake", ru: "Найди и исправь ошибку", checkable: true },
  mark: { g: "extra", en: "Highlight words in a text", ru: "Выдели слова в тексте", checkable: true },
  transform: { g: "extra", en: "Key word transformation", ru: "Перефразирование", checkable: true },
  translate: { g: "extra", en: "Translate sentences", ru: "Перевод предложений", checkable: true },
  dictation: { g: "extra", en: "Dictation", ru: "Диктант", checkable: true },
  crossword: { g: "extra", en: "Crossword", ru: "Кроссворд", checkable: true },
};
export const ALL_TYPES = Object.keys(TYPES) as TaskType[];
export const isType = (t: string): t is TaskType => t in TYPES;
/** Есть ли у задания номер: только у заданий с формулировкой; без номера — разделитель, рамка Useful vocabulary и «без номера». */
export const numbered = (x: { type: string; title?: string | null; options?: { nonum?: boolean } | null }) =>
  x.type !== "divider" && x.type !== "vocab" && !x.options?.nonum && !!x.title?.trim();

export const PRESET: Record<TaskType, string[]> = {
  vocab: ["Useful vocabulary"],
  image: ["Look at the picture.", "Look at the picture and describe it.", "How does the picture make you feel?", "Do you see yourself in this picture?", "What story could this picture tell?", "What happened just before this picture was taken?"],
  video: ["Watch the video.", "Watch the video and answer the questions.", "Watch and summarise the video.", "Watch the video. What surprised you?"],
  audio: ["Listen.", "Listen and answer the questions.", "Listen and summarise.", "Listen and complete the sentences."],
  text: ["Read the text.", "Read the text and answer the questions.", "Read and find the words in bold.", "Skim the text. What is the main idea?"],
  wordset: ["Study the new words.", "Learn the words by heart.", "Listen and repeat the words.", "Read the words and the examples.", "Which of these words do you already know?"],
  note: ["Teacher’s note", "Tip"],
  link: ["Open the link.", "Useful link"],
  divider: [""],
  gap: ["Fill in the gaps.", "Put the verbs in the correct form.", "Complete the sentences.", "Fill in the gaps with one word."],
  drag: ["Complete the sentences with the words from the box.", "Drag the words into the gaps.", "Use the words from the box."],
  dropdown: ["Choose the correct option.", "Choose the correct form.", "Choose the best word."],
  test: ["Choose the correct answer.", "Choose all correct answers."],
  tf: ["True, false or not stated?", "Read and decide: true or false?", "Are the sentences true or false?"],
  pairs: ["Match the words to their definitions.", "Match the halves of the sentences.", "Match the questions to the answers."],
  columns: ["Sort the words into groups.", "Put the words in the right column."],
  picture: ["Match the words to the pictures.", "Write the word under each picture."],
  sentence: ["Put the words in the correct order.", "Make sentences."],
  textorder: ["Put the text in the correct order.", "Put the dialogue in order."],
  letters: ["Make the word from the letters."],
  essay: ["Write an essay.", "Write a short post.", "Write an email."],
  open: ["Answer the questions.", "Write your answer."],
  record: ["Record your answer.", "Tell us about it."],
  speak: ["Discuss the questions.", "Talk to your partner.", "Role-play the situation."],
  errors: ["Find and fix the mistakes.", "Each sentence has one mistake. Find it."],
  mark: ["Highlight the words.", "Find and highlight all the verbs in the past.", "Highlight the key words in the text.", "Highlight the phrases that show the speaker’s opinion."],
  transform: ["Rewrite the sentences using the word given."],
  translate: ["Translate into English.", "Translate the sentences using the new words."],
  dictation: ["Listen and write.", "Write the sentences you hear."],
  crossword: ["Solve the crossword."],
};

/** «Как оформить это задание» (EN, RU). */
export const HOWTO: Partial<Record<TaskType, [string, string]>> = {
  vocab: ["Useful words and phrases, one per line (or separated by commas). Shown in a coloured frame without a task number — put it anywhere in the lesson, e.g. under a speaking task.", "Полезные слова и фразы — по одному на строку (или через запятую). Показываются в цветной рамке без номера задания — ставьте в любое место урока, например под говорением."],
  gap: ["Put the answer in square brackets: She [went] home. The student sees a gap there. A hint goes in round brackets after it: [went](go). If two answers are right, split them with /: [colour / color].", "Возьмите ответ в квадратные скобки: She [went] home. Ученик увидит на этом месте пропуск. Подсказку пишите в круглых скобках после: [went](go). Если верны два ответа, разделите их /: [colour / color]."],
  dropdown: ["Put all options in one pair of brackets, split by /, and mark the right one with *: It’s fine to [make* / do / take] mistakes.", "Все варианты — в одних скобках через /, верный отметьте звёздочкой *: It’s fine to [make* / do / take] mistakes."],
  tf: ["Write a statement, a dash and T (true), F (false) or NS (not stated): Perfectionism can stop people — T", "Утверждение, тире и T (верно), F (неверно) или NS (не сказано): Perfectionism can stop people — T"],
  pairs: ["One pair per line, with a dash between: outcome — the result", "Одна пара на строку, через тире: outcome — the result"],
  columns: ["Column name, colon, then words with commas: Nouns: cat, house", "Название колонки, двоеточие и слова через запятую: Nouns: cat, house"],
  picture: ["One word per line, then add a picture for each word below.", "Одно слово на строку, затем ниже добавьте к каждому картинку."],
  sentence: ["Write correct sentences, one per line. The student gets the words mixed up. Glue words that go together with _: look_after.", "Пишите правильные предложения, по одному на строку. Ученик получит слова вперемешку. Слова, которые идут вместе, склейте через _: look_after."],
  textorder: ["Write the lines in the right order. The student gets them mixed up.", "Пишите строки в правильном порядке. Ученик получит их вперемешку."],
  letters: ["word — hint: patient — able to wait calmly", "слово — подсказка: patient — able to wait calmly"],
  test: ["Question on one line, options below it, one per line. Mark the right one with *. Leave an empty line between questions.", "Вопрос на одной строке, ниже варианты, по одному на строку. Верный отметьте *. Между вопросами — пустая строка."],
  mark: ["Write the text. Put the words or phrases the student must find in square brackets: I [went] home and [saw] a film. The student taps words to highlight them; brackets are not shown. A phrase in one pair of brackets counts as one item: [look after]. Without brackets the student highlights freely and nothing is checked.", "Напишите текст. Слова или фразы, которые ученик должен найти, возьмите в квадратные скобки: I [went] home and [saw] a film. Ученик нажимает на слова — они выделяются плашкой; скобок он не видит. Фраза в одних скобках — один элемент: [look after]. Без скобок ученик выделяет что хочет, проверки нет."],
  errors: ["Put both forms in square brackets with / and mark the right one with *: She [don’t / doesn’t*] like coffee. The student sees the wrong form in the sentence.", "Обе формы — в квадратных скобках через /, верную отметьте *: She [don’t / doesn’t*] like coffee. Ученик увидит в предложении неверную форму."],
  transform: ["Sentence | KEY WORD → answer. Several right answers: split them with /.", "Предложение | КЛЮЧЕВОЕ СЛОВО → ответ. Несколько верных ответов — через /."],
  translate: ["Russian sentence → English answer. Several right answers: split them with /.", "Русское предложение → английский ответ. Несколько верных ответов — через /."],
  crossword: ["word — clue, one per line", "слово — подсказка, по одному на строку"],
  speak: ["One question per line.", "Один вопрос на строку."],
  dictation: ["One sentence per line. The platform reads them aloud to the student.", "Одно предложение на строку. Платформа прочитает их ученику вслух."],
  wordset: ["word — translation — example, one word per line: outcome — результат — We can’t control the outcome.", "слово — перевод — пример, по одному слову на строку: outcome — результат — We can’t control the outcome."],
  open: ["One question per line. The student writes an answer to each.", "Один вопрос на строку. Ученик пишет ответ на каждый."],
  essay: ["Write the topic or the task. Set a word limit in the options.", "Напишите тему или задание. Лимит слов — в опциях."],
  record: ["Write what the student should talk about.", "Напишите, о чём ученик должен рассказать."],
  text: ["Paste the text. **bold**, *italic*; an empty line starts a new paragraph.", "Вставьте текст. **жирный**, *курсив*; пустая строка — новый абзац."],
  note: ["A note for the teacher (hidden from the student by default; open the eye to show it).", "Заметка для учителя (по умолчанию ученик её не видит — откройте глазик, чтобы показать)."],
};
HOWTO.drag = HOWTO.gap;

/** Короткая подсказка под полем (EN, RU). */
export const HELP: Partial<Record<TaskType, [string, string]>> = {
  vocab: ["one word or phrase per line", "по слову или фразе на строку"],
  gap: ["[word] — gap · [went](go) — hint · [a / b] — both right", "[слово] — пропуск · [went](go) — подсказка · [a / b] — оба верны"],
  drag: ["[word] — gap; words go into the box", "[слово] — пропуск; слова уйдут в блок"],
  dropdown: ["[right* / wrong / wrong]", "[верный* / неверный / неверный]"],
  tf: ["statement — T / F / NS", "утверждение — T / F / NS"],
  pairs: ["left — right", "левое — правое"],
  columns: ["Column: word, word", "Колонка: слово, слово"],
  picture: ["one word per line", "одно слово на строку"],
  sentence: ["one sentence per line", "одно предложение на строку"],
  textorder: ["lines in the right order", "строки в верном порядке"],
  letters: ["word — hint", "слово — подсказка"],
  test: ["question, options below, right one with *", "вопрос, ниже варианты, верный с *"],
  errors: ["[wrong / right*]", "[неверно / верно*]"],
  mark: ["[word] — to find · without brackets — free highlighting", "[слово] — найти · без скобок — выделяет что хочет"],
  transform: ["sentence | KEY WORD → answer", "предложение | КЛЮЧ → ответ"],
  translate: ["Russian → English", "русское → английское"],
  crossword: ["word — clue", "слово — подсказка"],
  speak: ["one question per line", "один вопрос на строку"],
  dictation: ["one sentence per line", "одно предложение на строку"],
  wordset: ["word — translation — example", "слово — перевод — пример"],
  open: ["one question per line", "один вопрос на строку"],
};

/** Пример содержания — подставляется в новое задание. */
export const SAMPLE: Partial<Record<TaskType, string>> = {
  vocab: "I'd rather…\nIn my opinion,\nOn the other hand,\nto be honest",
  gap: "Yesterday I [went](go) to the cinema.\nShe [has lived](live) here since 2019.\nThere’s little point in [trying] to be perfect.",
  drag: "Don’t let fear [hold you back].\nShe decided to [give it a go].\nYou don’t have to [get it right] the first time.\nIt’s a [worthwhile] project.\nWe can’t control the [outcome].",
  dropdown: "It’s fine to [make* / do / take] mistakes.\nYou can [start* / begin* / finish] small.",
  tf: "Perfectionism can stop people from starting. — T\nThe author says you should wait for the right moment. — F\nMost people become perfectionists at school. — NS",
  pairs: "hold back — stop someone from doing something\ngive it a go — try something\noutcome — the result of something",
  columns: "Positive: proud, confident, relaxed\nNegative: worried, stressed, afraid",
  sentence: "I have never felt so relaxed\nShe has been working here for two years",
  textorder: "First, she makes a cup of tea.\nThen she reads an English book.\nAfter that, she listens to music.",
  letters: "summer — warm season\nautumn — leaves fall",
  test: "They ___ to the cinema at the moment.\nare going*\ngoing\ngo\n\nWhat do you do?\nI’m a manager.*\nI’m managing.\nI manage.",
  errors: "She [don’t / doesn’t*] like coffee.\nI [am agree / agree*] with you.",
  mark: "Last summer I [went] to the seaside. I [swam] every day and [ate] a lot of ice cream. Now I study at home.",
  transform: "It isn’t worth waiting for the perfect moment. | POINT → There’s no point in waiting for the perfect moment.",
  translate: "Нет смысла ждать идеального момента. → There’s no point in waiting for the perfect moment.\nСтоит попробовать. → It’s worth a try. / It’s worth trying.",
  crossword: "outcome — the result of something\nattempt — a try\nproud — feeling good about what you did\npressure — stress from work or people\nembrace — accept something gladly",
  speak: "Do you try to do everything perfectly?\nWhat would you start tomorrow if you weren’t afraid of mistakes?",
  dictation: "I have never been to London.\nShe decided to give it a go.",
  wordset: "outcome — результат — We can’t control the outcome.\nattempt — попытка — It was my first attempt.\nproud — гордый — She’s proud of her work.",
  open: "What do you do when you make a mistake?\nWhat are you proud of?",
  essay: "Is it important to be perfect? Write 120–150 words.",
  record: "Tell us about a time you were afraid to make a mistake.",
  text: "Many people believe that **perfectionism** helps them do better work.\n\nIn fact, it often stops them from *starting* at all.",
  note: "Remember: mistakes help you learn.",
};

export type Rubric = { id: string; title: string };
export const RUBRICS = ["Lead-in", "Warm-up", "Revision", "Vocabulary", "Grammar", "Reading", "Listening", "Video", "Speaking", "Writing", "Pronunciation", "Game", "Wrap-up"];

/** Подсказки по рубрикам (EN, RU) и подходящие типы заданий. */
export const RTIPS: Record<string, { tips: [string, string][]; tasks: TaskType[] }> = {
  "lead-in": { tips: [["Ask 2–3 personal questions on the topic: what do you think, have you ever…", "Задайте 2–3 личных вопроса по теме: что вы думаете, бывало ли у вас…"], ["Show a picture or a short quote and ask the student to guess the topic", "Покажите картинку или короткую цитату и попросите угадать тему урока"]], tasks: ["speak", "image"] },
  "warm-up": { tips: [["Revise last lesson’s words with a quick game", "Повторите слова прошлого урока в быстрой игре"], ["A 2-minute speaking task to get the student talking", "Короткое говорение на 2 минуты, чтобы «разговорить» ученика"]], tasks: ["pairs", "speak"] },
  vocabulary: { tips: [["After a multiple choice, add Match pairs, then Gaps in a context", "После теста добавьте «Соедини пары», а потом «Пропуски» в контексте"], ["Finish with Speaking: the student uses 5 new words in their own sentences", "Завершите говорением: ученик использует 5 новых слов в своих предложениях"], ["Word to picture works well for concrete nouns", "«Слово к картинке» хорошо подходит для конкретных существительных"]], tasks: ["pairs", "gap", "picture", "crossword"] },
  grammar: { tips: [["Start with examples from the text, ask the student to spot the pattern", "Начните с примеров из текста и попросите ученика найти закономерность"], ["Controlled practice first, then freer practice", "Сначала контролируемая практика, потом свободная"]], tasks: ["gap", "dropdown", "transform"] },
  reading: { tips: [["Before reading: predict the content from the title", "До чтения: угадать содержание по заголовку"], ["Gist question first, then True/False for details", "Сначала вопрос на общее понимание, потом True/False на детали"]], tasks: ["text", "tf", "test"] },
  listening: { tips: [["Set a task before the first listening", "Дайте задание до первого прослушивания"], ["Second listening: gaps or dictation for details", "Второе прослушивание: пропуски или диктант на детали"]], tasks: ["audio", "gap", "dictation"] },
  speaking: { tips: [["Give a clear goal and useful phrases", "Дайте понятную цель и полезные фразы"], ["AI conversation partner for extra practice at home", "ИИ-собеседник для дополнительной практики дома"]], tasks: ["speak", "record"] },
  writing: { tips: [["Give a model text first", "Сначала дайте образец текста"], ["Essay with a word limit; the teacher checks it", "Эссе с лимитом слов; проверяет учитель"]], tasks: ["essay", "open"] },
  "wrap-up": { tips: [["Ask: what are 3 things you learned today?", "Спросите: какие 3 вещи вы сегодня узнали?"], ["Quick self-check test of 3–5 questions", "Короткий тест-самопроверка из 3–5 вопросов"]], tasks: ["test", "open"] },
};
export const rubricKey = (title: string) => {
  const t = title.toLowerCase().replace(/[^a-z-]/g, "");
  return Object.keys(RTIPS).find((k) => t.includes(k.replace("-", "")) || t.includes(k)) ?? null;
};

export const COURSE_CATEGORIES: [string, string, string][] = [
  ["general", "General English", "Общий английский"],
  ["grammar", "Grammar", "Грамматика"],
  ["vocabulary", "Vocabulary", "Лексика"],
  ["exams", "International exams", "Международные экзамены"],
  ["ege_oge", "ЕГЭ / ОГЭ", "ЕГЭ / ОГЭ"],
  ["speaking", "Speaking", "Разговорный английский"],
  ["business", "Business English", "Бизнес-английский"],
  ["kids", "Kids", "Для детей"],
];

/** Опции задания (хранятся в Task.options). */
export type TaskOptions = {
  hidden?: boolean; nonum?: boolean; noreveal?: boolean; checkMode?: "instant" | "button"; mode?: "gap" | "drag";
  split?: boolean; seriesSize?: number; limitWords?: number; limitSec?: number; showScript?: boolean; script?: string;
  src?: string; images?: { src: string; caption?: string }[]; layout?: "carousel" | "stack"; pics?: string[];
  url?: string; label?: string; ns?: boolean; check?: boolean; multi?: boolean; across?: boolean; teacherOnly?: boolean;
  aipre?: boolean; ai?: boolean; aiPrompt?: string; aiGoal?: string; aiWords?: string; aiMins?: number;
  clipStart?: number; clipEnd?: number; // отрывок видео, секунды
};
