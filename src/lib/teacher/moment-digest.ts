import "server-only";
import { db } from "../db";
import { notify } from "../notify";
import { isoDay } from "../time";
import { momentsFor, type Moment } from "./moments";

const WD = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];

function line(m: Moment) {
  const when = m.days === 0 ? "сегодня" : WD[new Date(`${m.day}T12:00:00Z`).getUTCDay()];
  switch (m.kind) {
    case "birthday": return `${m.name} — день рождения (${when})`;
    case "lessons": return `${m.name} — ${m.n}-й урок вместе (${when})`;
    case "together": return `${m.name} — ${(m.give?.name ?? "год вместе").toLowerCase()} (${when})`;
    case "active": return `${m.name} — больше всех занимается на платформе`;
    case "streak": return `${m.name} — ${m.n} дней подряд тренирует слова`;
    default: return `${m.name} — ${m.text} (${when})`;
  }
}

/** Воскресенье, 22:00 по времени учителя: сводка «события учеников на неделю» — в «Что нового» (и в Telegram по настройкам). */
export async function weeklyMoments(now = new Date()) {
  const teachers = await db.teacherProfile.findMany({ where: { students: { some: { status: "ACTIVE" } } }, select: { userId: true, user: { select: { timezone: true } } } });
  for (const p of teachers) {
    const tz = p.user.timezone;
    const parts = new Intl.DateTimeFormat("en-GB", { weekday: "short", hour: "2-digit", hour12: false, timeZone: tz }).formatToParts(now);
    const wd = parts.find((x) => x.type === "weekday")?.value, hour = Number(parts.find((x) => x.type === "hour")?.value);
    if (wd !== "Sun" || hour < 22) continue;
    const dedupe = `moments:${p.userId}:${isoDay(now, tz)}`;
    if (await db.notification.findUnique({ where: { dedupe } })) continue;
    const list = (await momentsFor(p.userId, tz)).filter((m) => m.days >= 0 && m.days <= 7 && !m.given);
    if (!list.length) { await db.notification.create({ data: { userId: p.userId, kind: "moments", title: "События учеников на неделю: пока ничего особенного — хорошей недели!", link: "/teacher#moments", dedupe, readAt: now } }).catch(() => null); continue; }
    const title = `События учеников на неделю: ${list.slice(0, 4).map(line).join("; ")}${list.length > 4 ? ` и ещё ${list.length - 4}` : ""}`;
    await notify({ userId: p.userId, kind: "moments", title, link: "/teacher#moments", dedupe });
  }
}
