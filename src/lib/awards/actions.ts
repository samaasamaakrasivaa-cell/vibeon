"use server";
import { revalidatePath } from "next/cache";
import { db } from "../db";
import { requireUser } from "../auth/session";
import { notify } from "../notify";
import { fromZoned, parseIsoDay } from "../time";
import { CHARACTER_KEYS } from "@/components/awards/Characters";
import { ICONS, METALS } from "./catalog";
import { getCatalog } from "./catalog-db";
import { takeTgAvatar } from "./avatar";

type R = { ok: true } | { ok: false; error: string };

async function teacherStudent(studentId: string) {
  const me = await requireUser("TEACHER");
  const s = await db.student.findUnique({ where: { id: studentId } });
  if (!s || s.teacherId !== me.id) throw new Error("not found");
  return { me, s };
}
const refresh = (studentId: string) => { revalidatePath(`/teacher/students/${studentId}`); revalidatePath("/student", "layout"); };

export type GiveInput = {
  kind: "title" | "cheer"; key: string | null; name: string; why: string; icon: string; color: string;
  term: "week" | "month" | "date" | "forever"; until?: string; onMain: boolean; tg: boolean;
};

/** Выдать статус: титул (качество; можно показать на главном экране) или поощрение (момент; только в «Мои награды»). */
export async function giveAward(studentId: string, x: GiveInput): Promise<R & { id?: string }> {
  const { me, s } = await teacherStudent(studentId);
  const name = x.name.trim().slice(0, 80);
  if (!name) return { ok: false, error: "name" };
  if (!(x.icon in ICONS) || !(x.color in METALS)) return { ok: false, error: "style" };
  const kind = x.kind === "cheer" ? "cheer" : "title";
  let until: Date | null = null;
  if (kind === "title") {
    if (x.term === "week") until = new Date(Date.now() + 7 * 864e5);
    else if (x.term === "month") until = new Date(Date.now() + 31 * 864e5);
    else if (x.term === "date") {
      const d = parseIsoDay(x.until ?? "");
      if (!d) return { ok: false, error: "date" };
      until = fromZoned(d.y, d.m, d.d, 23, 59, me.timezone);
    }
  }
  const onMain = kind === "title" && !!x.onMain;
  // первый титул на главном экране — сразу главный (корона, под именем)
  const hasPinned = onMain ? await db.award.count({ where: { studentId, pinned: true, kind: "title", OR: [{ until: null }, { until: { gt: new Date() } }] } }) : 1;
  // свой статус (не из каталога) — сохраняем в картотеку «Мои», чтобы выдавать снова
  const catalog = await getCatalog();
  const inCatalog = !!x.key && catalog.some((c) => c.key === x.key);
  if (!inCatalog) {
    const tpl = { why: x.why.trim().slice(0, 500) || null, icon: x.icon, color: x.color, term: kind === "title" ? x.term : "forever" };
    await db.awardTemplate.upsert({ where: { teacherId_kind_name: { teacherId: me.id, kind, name } }, create: { teacherId: me.id, kind, name, ...tpl }, update: tpl });
  }
  const created = await db.award.create({
    data: {
      studentId, teacherId: me.id, kind, key: inCatalog ? x.key : null, name,
      why: x.why.trim().slice(0, 500) || null, icon: x.icon, color: x.color, onMain, pinned: onMain && !hasPinned, until,
    },
  });
  if (s.userId) {
    const title = kind === "title" ? `Новый титул от преподавателя: «${name}»` : `Поощрение от преподавателя: «${name}»`;
    // в Telegram — по галочке учителя; в «Что нового» — всегда
    if (x.tg) await notify({ userId: s.userId, kind: "award", title, link: "/student/progress#awards", quiet: [22, 9] });
    else await db.notification.create({ data: { userId: s.userId, kind: "award", title, link: "/student/progress#awards" } });
  }
  refresh(studentId);
  return { ok: true, id: created.id };
}

async function ownAward(id: string) {
  const me = await requireUser("TEACHER");
  const a = await db.award.findUnique({ where: { id } });
  if (!a || a.teacherId !== me.id) throw new Error("not found");
  return a;
}

/** Показывать титул у приветствия ученика или только в «Мои награды». */
export async function setAwardMain(id: string, onMain: boolean): Promise<R> {
  const a = await ownAward(id);
  if (a.kind !== "title") return { ok: false, error: "kind" };
  await db.award.update({ where: { id }, data: { onMain, ...(onMain ? {} : { pinned: false }) } });
  if (onMain && !(await db.award.count({ where: { studentId: a.studentId, pinned: true } }))) await db.award.update({ where: { id }, data: { pinned: true } });
  refresh(a.studentId);
  return { ok: true };
}

/** Сделать титул главным: под именем ученика, корона на аватарке. */
export async function pinAward(id: string): Promise<R> {
  const a = await ownAward(id);
  if (a.kind !== "title") return { ok: false, error: "kind" };
  await db.$transaction([
    db.award.updateMany({ where: { studentId: a.studentId, pinned: true }, data: { pinned: false } }),
    db.award.update({ where: { id }, data: { pinned: true, onMain: true } }),
  ]);
  refresh(a.studentId);
  return { ok: true };
}

/** Изменить выданный статус: название, «за что», значок, металл; у титула — срок (yyyy-mm-dd или пусто — бессрочно). */
export async function updateAward(id: string, x: { name: string; why: string; icon: string; color: string; until?: string | null }): Promise<R> {
  const a = await ownAward(id);
  const me = await requireUser("TEACHER");
  const name = x.name.trim().slice(0, 80);
  if (!name) return { ok: false, error: "name" };
  if (!(x.icon in ICONS) || !(x.color in METALS)) return { ok: false, error: "style" };
  let until: Date | null | undefined;
  if (a.kind === "title" && x.until !== undefined) {
    if (!x.until) until = null;
    else {
      const d = parseIsoDay(x.until);
      if (!d) return { ok: false, error: "date" };
      until = fromZoned(d.y, d.m, d.d, 23, 59, me.timezone);
    }
  }
  await db.award.update({ where: { id }, data: { name, why: x.why.trim().slice(0, 500) || null, icon: x.icon, color: x.color, ...(until !== undefined ? { until } : {}) } });
  refresh(a.studentId);
  return { ok: true };
}

/** Убрать свой статус из картотеки «Мои» (у учеников он остаётся). */
export async function deleteTemplate(id: string): Promise<R> {
  const me = await requireUser("TEACHER");
  await db.awardTemplate.deleteMany({ where: { id, teacherId: me.id } });
  revalidatePath("/teacher/students", "layout");
  return { ok: true };
}

export async function deleteAward(id: string): Promise<R> {
  const a = await ownAward(id);
  await db.award.delete({ where: { id } });
  refresh(a.studentId);
  return { ok: true };
}

// ───────── Ученик ─────────

async function myStudent() {
  const me = await requireUser("STUDENT");
  const s = await db.student.findUnique({ where: { userId: me.id } });
  if (!s) throw new Error("not found");
  return { me, s };
}

/** Праздничное окно показано. */
export async function markAwardSeen(id: string): Promise<R> {
  const { s } = await myStudent();
  await db.award.updateMany({ where: { id, studentId: s.id, seenAt: null }, data: { seenAt: new Date() } });
  return { ok: true };
}

/** Аватарка ученика: персонаж («char:owl»), своё загруженное фото (ссылка на файл) или фото из Telegram («tg»). */
export async function setMyAvatar(v: string): Promise<R> {
  const { me, s } = await myStudent();
  if (v === "tg") {
    const ok = await takeTgAvatar(s.id, false);
    if (!ok) return { ok: false, error: "tg" };
  } else if (v.startsWith("char:")) {
    if (!CHARACTER_KEYS.includes(v.slice(5))) return { ok: false, error: "char" };
    await db.student.update({ where: { id: s.id }, data: { avatar: v, avatarSrc: "char", avatarNotice: false } });
  } else {
    const m = /^\/api\/files\/(.+)$/.exec(v);
    const up = m ? await db.upload.findUnique({ where: { path: m[1] } }) : null;
    if (!up || up.ownerId !== me.id || !up.mime.startsWith("image/")) return { ok: false, error: "file" };
    await db.student.update({ where: { id: s.id }, data: { avatar: v, avatarSrc: "upload", avatarNotice: false } });
  }
  revalidatePath("/student", "layout");
  return { ok: true };
}

/** «Оставить» фото из Telegram — больше не спрашиваем. */
export async function keepMyAvatar(): Promise<R> {
  const { s } = await myStudent();
  await db.student.update({ where: { id: s.id }, data: { avatarNotice: false } });
  revalidatePath("/student", "layout");
  return { ok: true };
}
