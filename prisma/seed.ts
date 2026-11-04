// Демо-данные для разработки: учитель Эльвира, ученица Анна и ещё 9 учеников (пароль demo12345).
// Запуск: npm run db:seed. Пересоздаёт учеников и уроки демо-учителя.
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { PRESET, SAMPLE, type TaskType } from "../src/lib/tasks/catalog";
import { templateCriteria, templateStages } from "../src/lib/roadmap/cefr";

const db = new PrismaClient();
const TZ = "Europe/Moscow"; // UTC+3 без перехода на летнее время

/** Время в Москве → UTC. */
const msk = (base: Date, dayOffset: number, h: number, m = 0) => {
  const d = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate() + dayOffset, h - 3, m));
  return d;
};

async function main() {
  const passwordHash = await bcrypt.hash("demo12345", 12);
  const teacher = await db.user.upsert({
    where: { email: "teacher@demo.vibeon" },
    update: { passwordHash, timezone: TZ },
    create: {
      passwordHash, email: "teacher@demo.vibeon", name: "Elvira", lastName: "K.", role: "TEACHER", timezone: TZ, emailVerifiedAt: new Date(),
      teacherProfile: { create: { tariff: "TRIAL", trialUntil: new Date(Date.now() + 14 * 864e5) } },
    },
  });
  const annaUser = await db.user.upsert({
    where: { email: "student@demo.vibeon" },
    update: { passwordHash },
    create: { passwordHash, email: "student@demo.vibeon", name: "Anna", lastName: "Kuznetsova", role: "STUDENT", emailVerifiedAt: new Date() },
  });

  // Чистим демо-данные учителя
  await db.lessonInstance.deleteMany({ where: { OR: [{ teacherId: teacher.id }, { student: { teacherId: teacher.id } }] } });
  await db.student.deleteMany({ where: { teacherId: teacher.id } });
  await db.notification.deleteMany({ where: { userId: { in: [teacher.id, annaUser.id] } } });
  await db.course.deleteMany({ where: { teacherId: teacher.id } });

  // Понедельник текущей недели (по Москве)
  const nowMsk = new Date(Date.now() + 3 * 3600e3);
  const dow = (nowMsk.getUTCDay() + 6) % 7;
  const monday = new Date(Date.UTC(nowMsk.getUTCFullYear(), nowMsk.getUTCMonth(), nowMsk.getUTCDate() - dow));
  const started = new Date(monday.getTime() - 9 * 7 * 864e5);

  type P = { name: string; last: string; course: string; level: string; price: number; slots: [number, number, number][]; pack?: [number, number] };
  const people: P[] = [
    { name: "Anna", last: "Kuznetsova", course: "Speaking B2", level: "B1+", price: 3000, slots: [[0, 10, 0], [3, 9, 0]], pack: [10, 6] },
    { name: "Mikhail", last: "Denisov", course: "IELTS Foundation", level: "B2", price: 3500, slots: [[0, 8, 30], [2, 9, 0]] },
    { name: "Eva", last: "Sokolova", course: "Grammar Boost B1", level: "B1", price: 2500, slots: [[1, 17, 0], [3, 17, 0]] },
    { name: "Viktoria", last: "Lebedeva", course: "Business English", level: "B2", price: 3500, slots: [[1, 20, 0], [3, 20, 0]] },
    { name: "Elena", last: "Smirnova", course: "IELTS Foundation", level: "B1+", price: 3500, slots: [[2, 19, 0]] },
    { name: "Ekaterina", last: "Morozova", course: "Speaking B2", level: "B2", price: 3000, slots: [[4, 10, 0]] },
    { name: "Natalia", last: "Petrova", course: "Grammar Boost B1", level: "A2+", price: 2500, slots: [[4, 11, 0]], pack: [8, 3] },
    { name: "Yaroslav", last: "Titov", course: "Business English", level: "B2+", price: 4000, slots: [[5, 14, 0]] },
    { name: "Kristina", last: "Volkova", course: "Speaking B2", level: "B1", price: 3000, slots: [[6, 10, 0]] },
    { name: "Pavel", last: "Novikov", course: "Grammar Boost B1", level: "A2", price: 2500, slots: [[6, 9, 0]] },
  ];

  const now = Date.now();
  for (const [i, p] of people.entries()) {
    const s = await db.student.create({
      data: {
        teacherId: teacher.id, userId: i === 0 ? annaUser.id : null, name: p.name, lastName: p.last, status: "ACTIVE",
        email: `${p.name.toLowerCase()}@mail.ru`, telegram: `@${p.name.toLowerCase()}`, course: p.course, level: p.level, price: p.price,
        payType: p.pack ? "PACK" : "POSTPAID", billRule: p.pack ? "pack_left_1" : "after_15", remindEveryDays: 3, startedAt: started,
        packPrices: p.pack ? [{ n: 4, price: p.price * 4 - 400 }, { n: 8, price: p.price * 8 - 1600 }, { n: 12, price: p.price * 12 - 4800 }] : [],
        interests: i === 0 ? "Marketing, travel, Korean dramas" : null, source: i % 3 === 0 ? "Instagram" : i % 3 === 1 ? "Рекомендация" : "Avito",
        callLink: i === 0 ? "https://telemost.yandex.ru/j/58302917460312" : null,
        privateNote: i === 0 ? "Prefers speaking first, grammar at the end. Mixes up “work from” and “work with”." : null,
        form: i === 0 ? { phone: "+7 900 555-10-41", goals: ["Нужен для работы"], since: "1–3 года", easy: ["Чтение"], hard: ["Говорение", "Понимание на слух"], problem: "Понимаю, но не могу быстро ответить", filledAt: started.toISOString() } : { phone: "+7 900 000-00-0" + i },
        packs: p.pack ? { create: { lessonsTotal: p.pack[0], lessonsLeft: p.pack[1], price: p.price * p.pack[0] - 1600 } } : undefined,
      },
    });
    // Еженедельные серии: 9 недель в прошлом + полгода вперёд
    for (const [day, h, m] of p.slots) {
      const seriesId = randomUUID();
      const data = Array.from({ length: 9 + 26 }, (_, w) => {
        const startsAt = msk(started, w * 7 + day, h, m);
        const past = startsAt.getTime() + 3600e3 < now;
        const r = (w * 7 + day + i) % 17;
        const status = past ? (r === 3 ? "MISSED" : r === 7 ? "CANCELLED" : "DONE") : "PLANNED";
        return {
          teacherId: teacher.id, studentId: s.id, seriesId, startsAt, durationMin: 60, price: p.price, status: status as "DONE",
          charged: status !== "CANCELLED", note: !past && w === 9 && i === 0 ? "Повторить Present Perfect" : null,
        };
      });
      await db.lessonInstance.createMany({ data });
    }
  }
  // Пробный урок с новым человеком
  await db.lessonInstance.create({ data: { teacherId: teacher.id, isTrial: true, trialName: "Olga", startsAt: msk(monday, 2, 18, 0), durationMin: 30, price: 0 } });

  await db.notification.createMany({
    data: [
      { userId: teacher.id, kind: "move_request", title: "Eva asked to move Tuesday’s lesson to Wednesday, 19:00", action: "reply", link: "/teacher/schedule", createdAt: new Date(now - 10 * 60e3) },
      { userId: teacher.id, kind: "payment", title: "Anna paid for a new lesson pack: 30 000 ₽", action: "check_screenshot", link: "/teacher/finance", createdAt: new Date(now - 3600e3) },
      { userId: teacher.id, kind: "homework", title: "Mikhail sent his homework", action: "review", link: "/teacher/homework", createdAt: new Date(now - 3 * 3600e3) },
      { userId: teacher.id, kind: "question", title: "Eva asked a question about the Past Simple", action: "reply", link: "/teacher/questions", createdAt: new Date(now - 26 * 3600e3), readAt: new Date() },
    ],
  });

  // Курсы: юниты и уроки; урок «Anti-perfectionism» наполнен заданиями разных типов
  const plan: [string, string, string, [string, [string, string][]][]][] = [
    ["Speaking B2", "B2", "speaking", [
      ["Unit 1. Work and life", [["Work-life balance", "Vocabulary: work"], ["Remote or office?", "Speaking: opinions"], ["My dream job", "Present Perfect"], ["Burnout and how to avoid it", "Phrasal verbs"]]],
      ["Unit 2. City life", [["Living in a big city", "Comparatives"], ["Neighbours", "Small talk"], ["Getting around", "Prepositions of place"], ["City of the future", "Future forms"]]],
      ["Unit 3. Mindset", [["Anti-perfectionism", "Mistakes and progress"]]],
    ]],
    ["Grammar Boost B1", "B1", "grammar", [["Unit 1. Tenses", [["Present Simple vs Continuous", ""], ["Past Simple", ""], ["Present Perfect", ""]]]]],
    ["IELTS Foundation", "B1–B2", "exams", [["Unit 1. Reading", [["Skimming and scanning", ""], ["True / False / Not given", ""], ["Matching headings", ""]]], ["Unit 2. Writing", [["Task 1: graphs", ""], ["Task 2: opinion essay", ""], ["Linking words", ""]]]]],
    ["Business English", "B1–C1", "business", [["Unit 1. Meetings", [["Opening a meeting", ""], ["Agreeing and disagreeing", ""], ["Follow-up emails", ""]]]]],
  ];
  let richId = "";
  for (const [ci, [title, level, category, units]] of plan.entries()) {
    const c = await db.course.create({ data: { teacherId: teacher.id, title, level, category, order: ci, color: [2, 0, 1, 3][ci] } });
    for (const [ui, [ut, lessons]] of units.entries()) {
      const u = await db.unit.create({ data: { courseId: c.id, title: ut, order: ui, outcomes: [] } });
      for (const [li, [lt, sub]] of lessons.entries()) {
        const rub = [{ id: randomUUID(), title: "Lead-in" }, { id: randomUUID(), title: "Vocabulary" }, { id: randomUUID(), title: "Grammar" }];
        const l = await db.lessonTemplate.create({
          data: { unitId: u.id, title: lt, subtitle: sub || null, order: li, sections: rub, outcomes: lt === "Anti-perfectionism" ? ["talk about mistakes and progress", "use 10 new phrases about trying", "give advice with should / it’s worth"] : [] },
        });
        if (lt === "Anti-perfectionism") {
          richId = l.id;
          const put: [string, TaskType][] = [
            [rub[0].id, "speak"], [rub[0].id, "image"], [rub[1].id, "drag"], [rub[1].id, "pairs"], [rub[1].id, "crossword"], [rub[1].id, "tf"],
            [rub[2].id, "gap"], [rub[2].id, "dropdown"], [rub[2].id, "test"], [rub[2].id, "errors"], [rub[2].id, "sentence"], [rub[2].id, "transform"],
          ];
          await db.task.createMany({ data: put.map(([rid, ty], i) => ({ templateId: l.id, section: "lesson", rubricId: rid, type: ty, title: PRESET[ty][0], content: SAMPLE[ty] ?? "", options: ty === "drag" ? { mode: "drag", split: true, seriesSize: 5 } : ty === "tf" ? { checkMode: "instant" } : {}, order: i })) });
          await db.task.createMany({ data: (["open", "translate", "dictation", "essay", "record"] as TaskType[]).map((ty, i) => ({ templateId: l.id, section: "homework", type: ty, title: PRESET[ty][0], content: SAMPLE[ty] ?? "", options: ty === "essay" ? { limitWords: 150, aipre: true } : {}, order: i })) });
          await db.task.create({ data: { templateId: l.id, section: "words", type: "wordset", title: PRESET.wordset[0], content: SAMPLE.wordset!, options: {}, order: 0 } });
        }
      }
    }
  }
  // Ближайший урок Анны — по «Anti-perfectionism»
  const annaNext = await db.lessonInstance.findFirst({ where: { student: { userId: annaUser.id }, status: "PLANNED", startsAt: { gt: new Date() } }, orderBy: { startsAt: "asc" } });
  if (annaNext && richId) await db.lessonInstance.update({ where: { id: annaNext.id }, data: { templateId: richId } });


  // Кабинет ученика (Анна): слова, тренировки, прошлый урок с домашкой, вопрос, фидбэк, переписка
  const anna = await db.student.findFirst({ where: { userId: annaUser.id } });
  if (anna && richId) {
    await db.word.deleteMany({ where: { studentId: anna.id } });
    await db.wordPractice.deleteMany({ where: { studentId: anna.id } });
    const words: [string, string, string, number][] = [
      ["hold you back", "сдерживать, мешать", "Don’t let fear of mistakes hold you back.", 1], ["give it a go", "попробовать", "She decided to give it a go.", 2],
      ["get it right", "сделать правильно", "You don’t have to get it right the first time.", 0], ["worthwhile", "стоящий", "It’s a worthwhile project.", 1],
      ["outcome", "результат, исход", "We can’t control the outcome.", 3], ["attempt", "попытка", "It was my first attempt.", 2], ["embrace", "принимать", "Embrace your mistakes.", 0],
      ["deadline", "срок", "The deadline is on Friday.", 4], ["commute", "дорога на работу", "My commute takes an hour.", 4], ["burnout", "выгорание", "Burnout is common in IT.", 4],
      ["remote", "удалённый", "I work remote three days a week.", 2], ["colleague", "коллега", "My colleague helped me.", 3], ["schedule", "расписание", "My schedule is busy.", 1], ["overtime", "сверхурочно", "I never work overtime.", 0],
    ];
    await db.word.createMany({ data: words.map(([word, translation, example, level], i) => ({ studentId: anna.id, word, translation, example, level, nextReviewAt: level >= 4 ? new Date(Date.now() + 10 * 864e5) : i % 3 === 0 ? new Date(Date.now() + 864e5) : null })) });
    const dayIso = (n: number) => new Date(Date.now() + 3 * 3600e3 - n * 864e5).toISOString().slice(0, 10);
    await db.wordPractice.createMany({ data: [1, 2, 3, 4, 5].map((n) => ({ studentId: anna.id, day: dayIso(n), count: 15 })).concat([{ studentId: anna.id, day: dayIso(0), count: 9 }]) });
    // прошлый проведённый урок Анны — тоже «Anti-perfectionism», с домашкой
    const lastDone = await db.lessonInstance.findFirst({ where: { studentId: anna.id, status: "DONE" }, orderBy: { startsAt: "desc" } });
    if (lastDone) {
      const hwTasks = await db.task.findMany({ where: { templateId: richId, section: "homework" }, orderBy: { order: "asc" } });
      await db.lessonInstance.update({ where: { id: lastDone.id }, data: { templateId: richId, finishedAt: lastDone.startsAt, note: "Повторить Present Simple: вопросы с do и does.", studentNote: "Закончить задания из Unit 3\nПотренировать Present Perfect" } });
      await db.homework.create({ data: { lessonInstanceId: lastDone.id, taskIds: hwTasks.map((t) => t.id), wordTraining: ["new"], teacherComment: "Обрати внимание на артикли." } });
      const open = hwTasks.find((t) => t.type === "open");
      if (open) await db.answer.create({ data: { lessonInstanceId: lastDone.id, taskId: open.id, studentId: anna.id, payload: { val: { 0: "I try again and don’t give up.", 1: "I’m proud of my progress in English." } }, status: "NEEDS_REVIEW" } });
      await db.feedback.create({ data: { studentId: anna.id, lessonInstanceId: lastDone.id, text: "Отличный урок! Ты уверенно используешь новые фразы. Поработай над Present Perfect в вопросах." } });
    }
    await db.question.create({ data: { studentId: anna.id, text: "Is “work with home” always wrong?", context: "Speaking B2 · Unit 1 · Work-life balance", askedTeacher: true } });
    await db.message.createMany({ data: [
      { studentId: anna.id, senderId: teacher.id, text: "Анна, не забудь домашку к четвергу 🙂", createdAt: new Date(Date.now() - 26 * 3600e3), readAt: new Date() },
      { studentId: anna.id, senderId: annaUser.id, text: "Спасибо! Можно перенести урок в четверг на 18:00?", createdAt: new Date(Date.now() - 2 * 3600e3) },
    ] });
  }


  // Оплаты: история прошлого уже оплачена и списана; свежие уроки ждут счёта. Демо-счета для «Проверить постоплаты».
  const weekAgo = new Date(Date.now() - 6 * 864e5);
  await db.lessonInstance.updateMany({ where: { teacherId: teacher.id, startsAt: { lt: weekAgo } }, data: { billedAt: new Date(), deductedAt: new Date() } });
  await db.lessonInstance.updateMany({ where: { teacherId: teacher.id, student: { payType: "PACK" } }, data: { deductedAt: new Date() } });
  await db.teacherProfile.update({ where: { userId: teacher.id }, data: { settings: { payDetails: "Перевод по номеру телефона: +7 900 000-00-00\nБанк: Т-Банк\nПолучатель: Эльвира К." } } });
  const st = async (name: string) => db.student.findFirstOrThrow({ where: { teacherId: teacher.id, name } });
  const viktoria = await st("Viktoria"), natalia = await st("Natalia"), yaroslav = await st("Yaroslav"), anna2 = await st("Anna");
  await db.invoice.createMany({ data: [
    { studentId: anna2.id, amount: 24000, kind: "pack", title: "Абонемент, 8 занятий", packLessons: 8, status: "PAID", paidAt: new Date(Date.now() - 58 * 864e5), closedAt: new Date(), createdAt: new Date(Date.now() - 58 * 864e5) },
    { studentId: anna2.id, amount: 28400, kind: "pack", title: "Абонемент, 10 занятий", packLessons: 10, status: "PAID", paidAt: new Date(Date.now() - 30 * 864e5), closedAt: new Date(), createdAt: new Date(Date.now() - 30 * 864e5) },
    { studentId: viktoria.id, amount: 3500, kind: "lessons", title: "Урок 13 окт, 20:00", status: "SENT", createdAt: new Date(Date.now() - 4 * 864e5) },
    { studentId: viktoria.id, amount: 3500, kind: "lessons", title: "Урок 15 окт, 20:00", status: "PROOF_SENT", proofKind: "text", proofText: "Сбербанк, 18 октября, 3 500 ₽", proofAt: new Date(Date.now() - 2 * 864e5), aiRead: { source: "text", amounts: [3500], matches: true }, createdAt: new Date(Date.now() - 3 * 864e5) },
    { studentId: natalia.id, amount: 18400, kind: "pack", title: "Абонемент, 8 занятий", packLessons: 8, status: "PROOF_SENT", proofKind: "text", proofText: "Сбербанк · 16 окт, 11:40 · 2 500 ₽", proofAt: new Date(Date.now() - 864e5), aiRead: { source: "text", amounts: [2500], matches: false }, createdAt: new Date(Date.now() - 2 * 864e5) },
    { studentId: yaroslav.id, amount: 4000, kind: "lessons", title: "Урок 17 окт, 14:00", status: "SENT", createdAt: new Date(Date.now() - 864e5) },
  ] });

  // Маршрут Анны: входной тест (B1), срез, утверждённый маршрут B1 → B2 по курсу Speaking B2. Михаилу назначен входной тест.
  const speaking = await db.course.findFirst({ where: { teacherId: teacher.id, title: "Speaking B2" }, include: { units: { orderBy: { order: "asc" } } } });
  const units = speaking?.units.map((u) => ({ title: u.title, outcomes: u.outcomes })) ?? [];
  const stagesA = templateStages("ge", "B1", "B2", units);
  stagesA[0].passed = { score: 86, at: new Date(Date.now() - 20 * 864e5).toISOString() };
  const rmA = await db.roadmap.create({ data: {
    studentId: anna2.id, type: "ge", goal: "B2", fromLevel: "B1", pace: "2:20", mood: "plan", courseIds: speaking ? [speaking.id] : [], leadCourseId: speaking?.id ?? null,
    note: "Ответственная, любит говорить, перед дедлайнами на работе пропускает домашку.", stages: stagesA as object[], criteria: templateCriteria("ge", "B2") as object[], units,
    summary: "Маршрут B1 → B2: 3 этапа, около 230 учебных часов. Сначала — артикли и вопросы в Present Simple, затем свободная речь на встречах.",
    startHours: 42, builtAt: new Date(Date.now() - 50 * 864e5), approvedAt: new Date(Date.now() - 49 * 864e5), baseEta: new Date(Date.now() + 38 * 7 * 864e5), createdAt: new Date(Date.now() - 50 * 864e5),
  } });
  await db.checkpoint.createMany({ data: [
    { studentId: anna2.id, roadmapId: rmA.id, kind: "entry", status: "done", level: "B1", takenAt: new Date(Date.now() - 52 * 864e5), assignedAt: new Date(Date.now() - 53 * 864e5),
      results: { skills: { grammar: 64, vocabulary: 70, reading: 68, listening: 55, writing: 58 }, weak: [["Articles", "Артикли"], ["Present Simple questions", "Вопросы в Present Simple"], ["Listening: attitude", "Аудирование: позиция говорящего"]], strong: [["Past Simple", "Past Simple"]], score: 63 } },
    { studentId: anna2.id, roadmapId: rmA.id, kind: "slice", stage: 0, status: "done", level: "B1+", takenAt: new Date(Date.now() - 20 * 864e5), assignedAt: new Date(Date.now() - 21 * 864e5),
      results: { skills: { grammar: 78, vocabulary: 82, reading: 78, listening: 70, writing: 72 }, weak: [["Articles", "Артикли"]], strong: [], score: 76 } },
  ] });
  const mikhail = await st("Mikhail");
  await db.checkpoint.create({ data: { studentId: mikhail.id, kind: "entry" } });

  console.log("Seed OK:", teacher.email, annaUser.email, "· учеников:", people.length);
}

main().finally(() => db.$disconnect());
