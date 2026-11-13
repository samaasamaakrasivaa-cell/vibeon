import "server-only";
import { db } from "../db";
import { hhmm, isoDay, minutesOfDay, partsIn } from "../time";
import { deliverPending, notify } from "./index";
import { settingsOf } from "./settings";
import { pluralForm } from "@/lib/i18n/dict";
import { nextBirthday } from "../birthdays";

/** Напоминание об уроке: за N минут (из настроек), ученику и учителю; ссылка на класс. */
async function lessonReminders(now: Date) {
  const soon = await db.lessonInstance.findMany({
    where: { status: "PLANNED", startsAt: { gt: now, lte: new Date(now.getTime() + 1441 * 60e3) } },
    include: { student: { include: { user: true } }, template: true, group: { select: { title: true } } },
  });
  const teachers = new Map<string, Awaited<ReturnType<typeof db.user.findUnique>>>();
  for (const l of soon) {
    const mins = (l.startsAt.getTime() - now.getTime()) / 60e3;
    const who = [l.student?.user, l.teacherId ? (teachers.get(l.teacherId) ?? teachers.set(l.teacherId, await db.user.findUnique({ where: { id: l.teacherId } })).get(l.teacherId)) : null];
    for (const u of who) {
      if (!u) continue;
      const lead = settingsOf(u.role, u.notify).lessonLead;
      if (!lead || mins > lead) continue;
      const left = Math.max(1, Math.round(mins));
      const when = left >= 60 * 20 ? `завтра в ${hhmm(l.startsAt, u.timezone)}` : left >= 90 ? `в ${hhmm(l.startsAt, u.timezone)}` : `через ${left} мин`;
      const what = l.template?.title ? `«${l.template.title}»` : "";
      const title = u.role === "TEACHER"
        ? `Урок ${when}: ${l.isTrial ? `пробный${l.trialName ? ` — ${l.trialName}` : ""}` : `${l.group ? `группа «${l.group.title}»` : l.student?.name ?? ""} ${what}`}`.trim()
        : `Урок ${when}${what ? ` ${what}` : ""}. Ссылка на урок — в кабинете`;
      await notify({ userId: u.id, kind: "lesson", title, link: `/class/${l.id}`, dedupe: `lesson:${u.role === "TEACHER" && l.slotId ? l.slotId : l.id}:${u.id}:${l.startsAt.getTime()}` });
    }
  }
}

/** Слова: в дни тренировок, в выбранное время — если сегодня цель ещё не выполнена. */
async function wordReminders(now: Date) {
  const list = await db.student.findMany({ where: { status: "ACTIVE", userId: { not: null } }, include: { user: true } });
  for (const s of list) {
    const tz = s.user!.timezone;
    const p = partsIn(now, tz);
    const dow = p.dow; // 0 = Пн
    if (!s.wordDays.includes(dow)) continue;
    const [h, m] = s.remindAt.split(":").map(Number);
    const at = h * 60 + (m || 0), cur = minutesOfDay(now, tz);
    if (cur < at || cur > at + 120) continue;
    const day = isoDay(now, tz);
    const done = (await db.wordPractice.findUnique({ where: { studentId_day: { studentId: s.id, day } } }))?.count ?? 0;
    if (done >= s.wordGoal) continue;
    const due = await db.word.count({ where: { studentId: s.id, level: { lt: 4 } } });
    if (!due) continue;
    await notify({ userId: s.userId!, kind: "words", title: done ? `Ещё ${s.wordGoal - done} ${pluralForm("ru", s.wordGoal - done, ["слово", "слова", "слов"])} до цели дня — 5 минут, и готово!` : `Пора потренировать слова: цель на сегодня — ${s.wordGoal} слов`, link: "/student/words", dedupe: `words:${s.id}:${day}` });
  }
}

/** Домашка: если до следующего урока меньше суток, а домашка не сдана. */
async function homeworkReminders(now: Date) {
  const list = await db.homework.findMany({
    where: { status: "ASSIGNED", lessonInstance: { status: "DONE", startsAt: { gt: new Date(now.getTime() - 21 * 864e5) }, student: { userId: { not: null } } } },
    include: { lessonInstance: { include: { student: true } } },
  });
  for (const hw of list) {
    const l = hw.lessonInstance, s = l.student!;
    if (!hw.taskIds.length && !hw.extraTaskIds.length && !hw.wordTraining.length) continue;
    const next = await db.lessonInstance.findFirst({ where: { studentId: s.id, status: "PLANNED", startsAt: { gt: now } }, orderBy: { startsAt: "asc" } });
    if (!next || next.startsAt.getTime() - now.getTime() > 864e5) continue;
    const answered = await db.answer.count({ where: { lessonInstanceId: l.id, status: { not: "DRAFT" } } });
    if (answered >= hw.taskIds.length + hw.extraTaskIds.length && hw.taskIds.length + hw.extraTaskIds.length > 0) continue;
    await notify({ userId: s.userId!, kind: "hw_due", title: "Скоро урок — не забудь сделать домашку", link: `/class/${l.id}?tab=homework`, dedupe: `hw:${hw.id}:${next.id}` });
  }
}

/** Дни рождения учеников: учителю — за 3 дня и в сам день (дата из анкеты ученика). */
async function birthdayReminders(now: Date) {
  const list = await db.student.findMany({ where: { status: "ACTIVE", birthday: { not: null } }, select: { id: true, name: true, lastName: true, birthday: true, teacherId: true } });
  const teachers = new Map((await db.user.findMany({ where: { id: { in: [...new Set(list.map((s) => s.teacherId))] } }, select: { id: true, timezone: true } })).map((u) => [u.id, u]));
  for (const s of list) {
    const tu = teachers.get(s.teacherId);
    if (!tu || !s.birthday) continue;
    const b = nextBirthday(s.birthday, isoDay(now, tu.timezone));
    if (b.days !== 0 && b.days !== 3) continue;
    const name = [s.name, s.lastName].filter(Boolean).join(" ");
    const date = new Date(`${b.iso}T12:00:00Z`).toLocaleDateString("ru-RU", { day: "numeric", month: "long", timeZone: "UTC" });
    const age = b.age ? ` (исполнится ${b.age})` : "";
    await notify({
      userId: s.teacherId, kind: "birthday", link: `/teacher/students/${s.id}`,
      title: b.days === 0 ? `Сегодня день рождения у ${name}${age} 🎂` : `Через 3 дня, ${date}, день рождения у ${name}${age}`,
      dedupe: `bday:${s.id}:${b.iso}:${b.days}`,
    });
  }
}

let running = false;
export async function runNotify(now = new Date()) {
  if (running) return;
  running = true;
  try {
    await lessonReminders(now);
    await wordReminders(now);
    await homeworkReminders(now);
    await birthdayReminders(now);
    await deliverPending(now);
  } catch (e) {
    console.error("[notify]", e);
  } finally {
    running = false;
  }
}
