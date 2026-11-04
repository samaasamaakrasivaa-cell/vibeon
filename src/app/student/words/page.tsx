import { WordsView } from "@/components/student/WordsView";
import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { addDaysIso, isoDay, mondayOf } from "@/lib/time";

export const metadata = { title: "Слова" };
export const dynamic = "force-dynamic";

export default async function Words({ searchParams }: { searchParams: Promise<{ train?: string; tab?: string }> }) {
  const me = await requireUser("STUDENT");
  const s = await db.student.findUnique({ where: { userId: me.id } });
  if (!s) return null;
  const sp = await searchParams;
  const now = new Date();
  const today = isoDay(now, me.timezone);
  const [words, log] = await Promise.all([
    db.word.findMany({ where: { studentId: s.id }, orderBy: [{ level: "asc" }, { createdAt: "desc" }] }),
    db.wordPractice.findMany({ where: { studentId: s.id, day: { gte: addDaysIso(today, -120) } } }),
  ]);
  const byDay = new Map(log.map((x) => [x.day, x.count]));
  // серия: дни подряд с тренировкой (сегодня ещё можно успеть — считаем со вчера)
  let streak = 0;
  for (let d = byDay.get(today) ? today : addDaysIso(today, -1); byDay.get(d); d = addDaysIso(d, -1)) streak++;
  const monday = mondayOf(today);
  const week = Array.from({ length: 7 }, (_, i) => { const d = addDaysIso(monday, i); return { label: d, done: (byDay.get(d) ?? 0) >= s.wordGoal, planned: s.wordDays.includes(i), today: d === today }; });
  return (
    <div className="page">
      <WordsView
        words={words.map((w) => ({ id: w.id, word: w.word, translation: w.translation, example: w.example, ownExample: w.ownExample, level: w.level, due: !w.nextReviewAt || w.nextReviewAt <= now }))}
        goal={s.wordGoal} days={s.wordDays} remindAt={s.remindAt} doneToday={byDay.get(today) ?? 0} week={week} streak={streak}
        train={sp.train === "today" || sp.train === "all" ? sp.train : null} tab={sp.tab === "list" ? "list" : "overview"}
      />
    </div>
  );
}
