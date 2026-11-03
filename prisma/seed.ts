// Демо-данные для разработки: учитель Эльвира и ученица Анна.
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function main() {
  const teacher = await db.user.upsert({
    where: { email: "teacher@demo.vibeon" },
    update: {},
    create: {
      email: "teacher@demo.vibeon",
      name: "Elvira",
      lastName: "K.",
      role: "TEACHER",
      emailVerifiedAt: new Date(),
      teacherProfile: { create: { tariff: "TRIAL", trialUntil: new Date(Date.now() + 14 * 864e5) } },
    },
  });

  const studentUser = await db.user.upsert({
    where: { email: "student@demo.vibeon" },
    update: {},
    create: { email: "student@demo.vibeon", name: "Anna", lastName: "Kuznetsova", role: "STUDENT", emailVerifiedAt: new Date() },
  });

  const student = await db.student.upsert({
    where: { userId: studentUser.id },
    update: {},
    create: { userId: studentUser.id, teacherId: teacher.id, name: "Anna", lastName: "Kuznetsova", status: "ACTIVE", payType: "PACK", price: 3000 },
  });

  if ((await db.lessonInstance.count({ where: { studentId: student.id } })) === 0) {
    const base = new Date(); base.setHours(10, 0, 0, 0);
    await db.lessonInstance.createMany({
      data: [0, 2, 4].map((d) => ({ studentId: student.id, startsAt: new Date(base.getTime() + d * 864e5), durationMin: 60 })),
    });
  }
  console.log("Seed OK:", teacher.email, studentUser.email);
}

main().finally(() => db.$disconnect());
