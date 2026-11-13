"use server";
import { revalidatePath } from "next/cache";
import { db } from "../db";
import { requireUser } from "../auth/session";
import { getT } from "../i18n/server";

// Группы учеников. Групповое занятие — это урок у каждого ученика группы с общим slotId:
// оплата, абонементы, домашка и кабинет ученика работают как с обычными уроками, а в расписании и в классе это одно занятие.

type R = { ok: true; id?: string } | { ok: false; error: string };
type Input = { title: string; price?: number | null; memberIds: string[]; level?: string; callLink?: string; info?: string };
// настройки группы: уровень, ссылка на созвон (подставляется в класс), «О группе» — заметка учителя
const extra = (i: Input) => ({
  level: (i.level ?? "").trim().slice(0, 20) || null,
  callLink: /^https?:\/\/\S+$/i.test((i.callLink ?? "").trim()) ? (i.callLink ?? "").trim().slice(0, 500) : null,
  info: (i.info ?? "").trim().slice(0, 3000) || null,
});

async function me() {
  return requireUser("TEACHER");
}

const cleanPrice = (p: unknown) => {
  const n = Math.round(Number(p));
  return Number.isFinite(n) && n > 0 ? Math.min(n, 1_000_000) : null;
};

async function ownStudents(ids: string[], teacherId: string) {
  const list = await db.student.findMany({ where: { id: { in: [...new Set(ids)].slice(0, 50) }, teacherId, status: { in: ["ACTIVE", "INVITED"] } } });
  return list;
}

function refresh() {
  revalidatePath("/teacher", "layout");
}

export async function createGroup(input: Input): Promise<R> {
  const { t } = await getT();
  const teacher = await me();
  const title = (input.title ?? "").trim().slice(0, 80);
  if (!title) return { ok: false, error: t("grp.err.title") };
  const members = await ownStudents(input.memberIds ?? [], teacher.id);
  if (members.length < 1) return { ok: false, error: t("grp.err.members") };
  if (input.callLink?.trim() && !extra(input).callLink) return { ok: false, error: t("grp.err.link") };
  const g = await db.group.create({ data: { teacherId: teacher.id, title, price: cleanPrice(input.price), ...extra(input), members: { create: members.map((s) => ({ studentId: s.id })) } } });
  refresh();
  return { ok: true, id: g.id };
}

/** Название, цена и состав. Новым участникам добавляются будущие занятия группы, у ушедших будущие занятия удаляются. */
export async function updateGroup(id: string, input: Input): Promise<R> {
  const { t } = await getT();
  const teacher = await me();
  const g = await db.group.findUnique({ where: { id }, include: { members: true } });
  if (!g || g.teacherId !== teacher.id) return { ok: false, error: "not found" };
  const title = (input.title ?? "").trim().slice(0, 80);
  if (!title) return { ok: false, error: t("grp.err.title") };
  const members = await ownStudents(input.memberIds ?? [], teacher.id);
  if (members.length < 1) return { ok: false, error: t("grp.err.members") };
  const price = cleanPrice(input.price);
  if (input.callLink?.trim() && !extra(input).callLink) return { ok: false, error: t("grp.err.link") };
  const now = new Date();
  const was = new Set(g.members.map((m) => m.studentId));
  const next = new Set(members.map((s) => s.id));
  const added = members.filter((s) => !was.has(s.id));
  const removed = [...was].filter((x) => !next.has(x));

  await db.$transaction(async (tx) => {
    await tx.group.update({ where: { id }, data: { title, price, ...extra(input) } });
    if (removed.length) {
      await tx.groupMember.deleteMany({ where: { groupId: id, studentId: { in: removed } } });
      await tx.lessonInstance.deleteMany({ where: { groupId: id, studentId: { in: removed }, status: "PLANNED", startsAt: { gt: now } } });
    }
    if (added.length) {
      await tx.groupMember.createMany({ data: added.map((s) => ({ groupId: id, studentId: s.id })), skipDuplicates: true });
      // будущие занятия группы: по одному уроку на занятие (slotId) — копия для нового участника
      const future = await tx.lessonInstance.findMany({ where: { groupId: id, status: "PLANNED", startsAt: { gt: now }, slotId: { not: null } }, orderBy: { id: "asc" } });
      const slots = new Map<string, (typeof future)[number]>();
      for (const l of future) if (!slots.has(l.slotId!)) slots.set(l.slotId!, l);
      if (slots.size)
        await tx.lessonInstance.createMany({
          data: [...slots.values()].flatMap((l) => added.map((s) => ({
            teacherId: teacher.id, studentId: s.id, groupId: id, slotId: l.slotId, seriesId: l.seriesId, templateId: l.templateId,
            startsAt: l.startsAt, durationMin: l.durationMin, price: price ?? s.price ?? null, callLink: l.callLink,
          }))),
        });
    }
    // цена группы поменялась — будущие занятия по новой цене
    if (price !== g.price) {
      const all = await tx.student.findMany({ where: { id: { in: [...next] } }, select: { id: true, price: true } });
      for (const s of all)
        await tx.lessonInstance.updateMany({ where: { groupId: id, studentId: s.id, status: "PLANNED", startsAt: { gt: now } }, data: { price: price ?? s.price ?? null } });
    }
  });
  refresh();
  return { ok: true, id };
}

/** Удалить группу: будущие занятия группы удаляются, проведённые остаются у учеников (в оплатах и истории). */
export async function deleteGroup(id: string): Promise<R> {
  const teacher = await me();
  const g = await db.group.findUnique({ where: { id } });
  if (!g || g.teacherId !== teacher.id) return { ok: false, error: "not found" };
  await db.$transaction([
    db.lessonInstance.deleteMany({ where: { groupId: id, status: "PLANNED", startsAt: { gt: new Date() } } }),
    db.group.delete({ where: { id } }),
  ]);
  refresh();
  return { ok: true };
}
