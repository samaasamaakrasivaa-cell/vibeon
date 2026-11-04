import "server-only";
import { db } from "../db";
import { roadmapView } from "./progress";

/** Недельный отчёт: по понедельникам с 9:00 (по времени ученика) — уведомление с итогами прошлой недели. */
export async function weeklyReports(now = new Date()) {
  const list = await db.roadmap.findMany({ where: { approvedAt: { not: null }, OR: [{ reportAt: null }, { reportAt: { lt: new Date(now.getTime() - 6 * 864e5) } }] }, include: { student: true }, take: 200 });
  for (const r of list) {
    const s = r.student;
    if (!s.userId || s.status !== "ACTIVE") continue;
    const local = new Date(now.toLocaleString("en-US", { timeZone: s.timezone }));
    if (local.getDay() !== 1 || local.getHours() < 9) continue;
    const v = await roadmapView(s.id, s.timezone, 0);
    if (!v.r || !v.week || !v.norm) continue;
    const got = v.week.les + v.week.hw + v.week.wd, need = v.norm.les + v.norm.hw + v.norm.wd;
    const p = Math.round((got / Math.max(0.1, need)) * 100);
    await db.notification.create({ data: { userId: s.userId, kind: "report", title: `Твой отчёт за неделю: ${p}% от нормы${(v.lateWeeks ?? 0) > 0 ? ` · прогноз сдвинулся на ${v.lateWeeks} нед.` : ""}`, action: "review", link: "/student/route" } });
    await db.roadmap.update({ where: { id: r.id }, data: { reportAt: now } });
  }
}
