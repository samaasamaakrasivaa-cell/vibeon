// Демо-данные для разработки: учитель Эльвира, ученица Анна и ещё 9 учеников (пароль demo12345).
// Запуск: npm run db:seed. Пересоздаёт учеников и уроки демо-учителя.
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";

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
  await db.notification.deleteMany({ where: { userId: teacher.id } });

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
  console.log("Seed OK:", teacher.email, annaUser.email, "· учеников:", people.length);
}

main().finally(() => db.$disconnect());
