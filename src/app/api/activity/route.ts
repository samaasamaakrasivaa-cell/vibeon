import { NextResponse, type NextRequest } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { isoDay } from "@/lib/time";
import { inLessonNow } from "@/lib/student/in-lesson";

/** Активная минута: клиент шлёт раз в минуту, только если в эту минуту были клики, ввод, прокрутка или переходы
 *  (фоново открытая вкладка не считается). Обновляет «был(а) в сети» и минуты за день. */
export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { cls?: boolean };
  const now = new Date();
  const day = isoDay(now, user.timezone);
  const row = await db.activityDay.findUnique({ where: { userId_day: { userId: user.id, day } } });
  // не чаще минуты: повторный сигнал раньше — только «в сети»
  const count = !row || now.getTime() - row.lastAt.getTime() >= 50_000;
  // ученик: минута во время урока по расписанию — «урок», иначе — домашка и самостоятельно
  const lessonNow = count && user.role === "STUDENT" ? await inLessonNow((await db.student.findMany({ where: { userId: user.id }, select: { id: true } })).map((x) => x.id), now) : false;
  await db.$transaction([
    db.user.update({ where: { id: user.id }, data: { lastSeenAt: now } }),
    db.activityDay.upsert({
      where: { userId_day: { userId: user.id, day } },
      create: { userId: user.id, day, minutes: 1, classMinutes: body.cls ? 1 : 0, lessonMinutes: lessonNow ? 1 : 0, lastAt: now },
      update: count ? { minutes: { increment: 1 }, ...(body.cls ? { classMinutes: { increment: 1 } } : {}), ...(lessonNow ? { lessonMinutes: { increment: 1 } } : {}), lastAt: now } : {},
    }),
  ]);
  return NextResponse.json({ ok: true });
}
