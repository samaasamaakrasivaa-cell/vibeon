"use server";
import { revalidatePath } from "next/cache";
import { db } from "../db";
import { requireUser } from "../auth/session";
import { isoDay } from "../time";
import { notify } from "../notify";
import { isKind } from "./kinds";

type R = { ok: true } | { ok: false; error: string };
export type SlotInput = { kind: string; title?: string; repeat: boolean; weekday?: number; date?: string; startMin: number; durMin: number; remind: boolean };

/** Чей слот можно менять: сам ученик или его учитель. Возвращает ученика и кто действует. */
async function who(studentId?: string) {
  const me = await requireUser();
  if (me.role === "STUDENT") {
    const s = await db.student.findUnique({ where: { userId: me.id }, select: { id: true, teacherId: true, timezone: true, userId: true, name: true } });
    if (!s) throw new Error("not found");
    return { s, teacher: false, me };
  }
  const s = studentId ? await db.student.findUnique({ where: { id: studentId }, select: { id: true, teacherId: true, timezone: true, userId: true, name: true } }) : null;
  if (!s || s.teacherId !== me.id) throw new Error("not found");
  return { s, teacher: true, me };
}

const done = (studentId: string) => { revalidatePath("/student/schedule"); revalidatePath(`/teacher/students/${studentId}`); };
const isoOk = (v?: string) => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);

function clean(x: SlotInput, tz: string) {
  if (!isKind(x.kind) || x.kind === "words") return null;
  const startMin = Math.max(0, Math.min(23 * 60 + 45, Math.round(x.startMin / 5) * 5));
  const durMin = Math.max(5, Math.min(240, Math.round(x.durMin / 5) * 5));
  if (x.repeat ? !(Number.isInteger(x.weekday) && x.weekday! >= 0 && x.weekday! <= 6) : !isoOk(x.date)) return null;
  return {
    kind: x.kind, title: (x.title ?? "").trim().slice(0, 80) || null, repeat: x.repeat, weekday: x.repeat ? x.weekday! : null, date: x.repeat ? null : x.date!,
    startMin, durMin, remind: !!x.remind, from: x.repeat ? isoDay(new Date(), tz) : x.date!,
  };
}

const KIND_RU: Record<string, string> = { homework: "домашка", words: "слова", film: "фильм / сериал", podcast: "подкаст / аудио", reading: "чтение", speaking: "говорение", grammar: "грамматика", club: "разговорный клуб", exam: "подготовка к экзамену" };

/** Новый слот (ученик себе или учитель ученику). */
export async function addSlot(x: SlotInput, studentId?: string): Promise<R> {
  const { s, teacher } = await who(studentId);
  const d = clean(x, s.timezone);
  if (!d) return { ok: false, error: "bad" };
  await db.studySlot.create({ data: { ...d, studentId: s.id, byTeacher: teacher } });
  // учитель поставил ученику слот — ученику уведомление
  if (teacher && s.userId) await notify({ userId: s.userId, kind: "lesson", title: `Преподаватель запланировал вам самостоятельную работу: ${d.title ?? KIND_RU[d.kind]}`, link: "/student/schedule" }).catch(() => null);
  done(s.id);
  return { ok: true };
}


/** Изменить слот целиком (для повторяющихся — всю серию с сегодняшнего дня: прошлые недели не трогаем). */
export async function updateSlot(id: string, x: SlotInput, studentId?: string): Promise<R> {
  const { s } = await who(studentId);
  const sl = await db.studySlot.findUnique({ where: { id } });
  if (!sl || sl.studentId !== s.id) return { ok: false, error: "not found" };
  const d = clean(x, s.timezone);
  if (!d) return { ok: false, error: "bad" };
  const today = isoDay(new Date(), s.timezone);
  if (sl.repeat && sl.from < today && d.repeat) {
    // серия шла раньше: старую закрываем сегодняшним днём, новая — с сегодняшнего (отметки прошлых недель остаются у старой)
    await db.$transaction([
      db.studySlot.update({ where: { id }, data: { until: today } }),
      db.studySlot.create({ data: { ...d, studentId: s.id, byTeacher: sl.byTeacher, from: today } }),
    ]);
  } else await db.studySlot.update({ where: { id }, data: { ...d, from: d.repeat ? (sl.repeat ? sl.from : today) : d.date! } });
  done(s.id);
  return { ok: true };
}

/** Удалить: только этот день (у повторяющегося) или весь слот / серию дальше. */
export async function removeSlot(id: string, scope: "day" | "all", day: string, studentId?: string): Promise<R> {
  const { s } = await who(studentId);
  const sl = await db.studySlot.findUnique({ where: { id } });
  if (!sl || sl.studentId !== s.id) return { ok: false, error: "not found" };
  if (scope === "day" && sl.repeat && isoOk(day)) {
    await db.studyLog.upsert({ where: { slotId_day: { slotId: id, day } }, create: { slotId: id, studentId: s.id, day, status: "removed" }, update: { status: "removed", minutes: 0 } });
  } else if (sl.repeat) {
    const today = isoDay(new Date(), s.timezone);
    // прошлые недели с отметками сохраняем (они в маршруте), дальше слот не повторяется
    if (sl.from < today) await db.studySlot.update({ where: { id }, data: { until: today } });
    else await db.studySlot.delete({ where: { id } });
  } else await db.studySlot.delete({ where: { id } });
  done(s.id);
  return { ok: true };
}

/** «Сделал» / снять отметку. Минуты сделанного идут в часы маршрута (кроме домашки и слов — они считаются сами). */
export async function markSlot(id: string, day: string, on: boolean, studentId?: string): Promise<R> {
  const { s } = await who(studentId);
  const sl = await db.studySlot.findUnique({ where: { id } });
  if (!sl || sl.studentId !== s.id || !isoOk(day)) return { ok: false, error: "not found" };
  if (day > isoDay(new Date(), s.timezone)) return { ok: false, error: "future" }; // будущее отметить нельзя
  if (on) await db.studyLog.upsert({ where: { slotId_day: { slotId: id, day } }, create: { slotId: id, studentId: s.id, day, status: "done", minutes: sl.durMin }, update: { status: "done", minutes: sl.durMin } });
  else await db.studyLog.deleteMany({ where: { slotId: id, day, status: "done" } });
  done(s.id);
  return { ok: true };
}

/** «Перенести»: этот день слота переносится на другой день и время (разовым слотом); пропуск без упрёков. */
export async function moveSlot(id: string, day: string, to: { date: string; startMin: number }, studentId?: string): Promise<R> {
  const { s } = await who(studentId);
  const sl = await db.studySlot.findUnique({ where: { id } });
  if (!sl || sl.studentId !== s.id || !isoOk(day) || !isoOk(to.date)) return { ok: false, error: "bad" };
  const startMin = Math.max(0, Math.min(23 * 60 + 45, Math.round(to.startMin / 5) * 5));
  await db.$transaction(async (tx) => {
    if (sl.repeat) await tx.studyLog.upsert({ where: { slotId_day: { slotId: id, day } }, create: { slotId: id, studentId: s.id, day, status: "moved" }, update: { status: "moved", minutes: 0 } });
    else await tx.studySlot.delete({ where: { id } });
    await tx.studySlot.create({ data: { studentId: s.id, kind: sl.kind, title: sl.title, repeat: false, date: to.date, startMin, durMin: sl.durMin, remind: sl.remind, byTeacher: sl.byTeacher, from: to.date } });
  });
  done(s.id);
  return { ok: true };
}

/** Слот «Слова» — это настройки слов: время напоминания и дни. Перенесли в расписании — меняются настройки. */
export async function setWordsTime(startMin: number, days: number[], studentId?: string): Promise<R> {
  const { s } = await who(studentId);
  const m = Math.max(0, Math.min(23 * 60 + 55, Math.round(startMin / 5) * 5));
  const at = `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  const wd = [...new Set(days.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort();
  if (!wd.length) return { ok: false, error: "days" };
  await db.student.update({ where: { id: s.id }, data: { remindAt: at, wordDays: wd } });
  done(s.id); revalidatePath("/student/words");
  return { ok: true };
}
