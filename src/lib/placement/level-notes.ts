// Шаблоны комментария ученику к итогу placement test: что уже умеешь на этом уровне и что подтянуть,
// чтобы перейти на следующий. Учитель вставляет шаблон кнопкой и правит под ученика.

type Note = { can: string; next: string };
const RU: Record<string, Note> = {
  A1: {
    can: "Ты знаешь базовые слова и фразы: можешь представиться, рассказать о себе, семье и своём дне простыми предложениями, понимаешь короткие медленные фразы на знакомые темы.",
    next: "Чтобы перейти на A2: закрепить Present Simple и Past Simple (вопросы и отрицания), расширить словарь по бытовым темам — покупки, еда, работа, город — и больше слушать короткие диалоги.",
  },
  A2: {
    can: "Ты общаешься в простых бытовых ситуациях, рассказываешь о прошлом опыте и планах, понимаешь короткие тексты, сообщения и объявления на знакомые темы.",
    next: "Чтобы перейти на B1: уверенно различать Past Simple и Present Perfect, освоить способы говорить о будущем и модальные глаголы, учиться связывать мысли (because, so, although) и говорить дольше одной-двух фраз.",
  },
  B1: {
    can: "Ты справляешься с большинством ситуаций в поездках и на работе, рассказываешь о событиях, впечатлениях и планах, понимаешь основное в текстах и речи на знакомые темы.",
    next: "Чтобы перейти на B2: отработать условные предложения, пассив и косвенную речь, пополнить словарь фразовыми глаголами и устойчивыми выражениями и тренироваться аргументировать свою точку зрения.",
  },
  B2: {
    can: "Ты свободно говоришь на многие темы, аргументируешь мнение, понимаешь сложные тексты и речь носителей в обычном темпе.",
    next: "Чтобы перейти на C1: сделать речь точнее и естественнее — сложные конструкции (инверсия, смешанные условные), идиомы и коллокации, связное письмо в деловом и академическом стиле.",
  },
  C1: {
    can: "Ты владеешь языком гибко и точно: понимаешь длинные сложные тексты и подтекст, говоришь бегло, почти не подбирая слова.",
    next: "Дальше — шлифовка до C2: стилистика, редкая лексика, оттенки значений и тексты разных жанров.",
  },
};
const EN: Record<string, Note> = {
  A1: { can: "You know basic words and phrases: you can introduce yourself, talk about yourself, your family and your day in simple sentences, and understand short, slow phrases on familiar topics.", next: "To reach A2: practise Present Simple and Past Simple (questions and negatives), build everyday vocabulary — shopping, food, work, the city — and listen to more short dialogues." },
  A2: { can: "You manage simple everyday situations, talk about past experiences and plans, and understand short texts, messages and announcements on familiar topics.", next: "To reach B1: tell Past Simple from Present Perfect with confidence, learn ways to talk about the future and modal verbs, link ideas (because, so, although) and speak for longer than a sentence or two." },
  B1: { can: "You cope with most situations when travelling and at work, describe events, impressions and plans, and understand the main points of texts and speech on familiar topics.", next: "To reach B2: practise conditionals, the passive and reported speech, add phrasal verbs and set phrases, and train arguing your point of view." },
  B2: { can: "You speak fluently on many topics, argue your opinion, and understand complex texts and native speakers at normal speed.", next: "To reach C1: make your English more precise and natural — advanced structures (inversion, mixed conditionals), idioms and collocations, coherent formal writing." },
  C1: { can: "You use English flexibly and precisely: you follow long, complex texts and implied meaning, and speak fluently without searching for words.", next: "Next comes polishing towards C2: style, rare vocabulary, shades of meaning and different genres of writing." },
};

/** Текст комментария к итогу: уровень (A2+, B1…), что умеешь, что подтянуть; темы с ошибками — первыми. */
export function levelNote(level: string, topics: string[], lang: "ru" | "en" = "ru") {
  const base = level.match(/^[ABC][12]/)?.[0] ?? "A1";
  const n = (lang === "en" ? EN : RU)[base] ?? RU.A1;
  const top = topics.slice(0, 3);
  // «Что ты уже умеешь: справляешься…» — без повтора «Ты» / «You» после двоеточия
  const can = n.can.replace(/^(Ты|You) /, "");
  if (lang === "en") return `Your level is ${level}.\n\nWhat you can already do: ${can}\n\nWhat to work on: ${top.length ? `first of all — ${top.join(", ")}. ` : ""}${n.next}`;
  return `Твой уровень — ${level}.\n\nЧто ты уже умеешь: ${can}\n\nНад чем поработать: ${top.length ? `в первую очередь — ${top.join(", ")}. ` : ""}${n.next}`;
}
