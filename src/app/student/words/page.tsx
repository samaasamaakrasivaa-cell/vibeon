import { StudyHead } from "@/components/student/SectionTabs";
import { WordsView } from "@/components/student/WordsView";
import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { wordCardKey } from "@/lib/ai/gateway";
import { parseWordCard, wordCardInput } from "@/lib/ai/word-card";
import { addDaysIso, isoDay, mondayOf } from "@/lib/time";
import { wordTranslations } from "@/lib/student/word-translations";

export const metadata = { title: "Слова" };
export const dynamic = "force-dynamic";

export default async function Words({ searchParams }: { searchParams: Promise<{ train?: string; tab?: string; goal?: string }> }) {
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
  // Общие словарные данные читаются из кэша только в списке «Мои слова».
  const cardKeys = new Map<string, string>();
  if (sp.tab === "list" && sp.train !== "today" && sp.train !== "all") {
    for (const word of words) {
      const input = wordCardInput(word.word, wordTranslations(word.translation)[0]);
      if (input) cardKeys.set(word.id, wordCardKey(input));
    }
  }
  const cachedCards = cardKeys.size
    ? await db.aiCache.findMany({ where: { key: { in: [...new Set(cardKeys.values())] } } })
    : [];
  const cardDetails = new Map(cachedCards.map((item) => [item.key, parseWordCard(item.value)]));
  const byDay = new Map(log.map((x) => [x.day, x.count]));
  // серия: дни подряд с тренировкой (сегодня ещё можно успеть — считаем со вчера)
  let streak = 0;
  for (let d = byDay.get(today) ? today : addDaysIso(today, -1); byDay.get(d); d = addDaysIso(d, -1)) streak++;
  const monday = mondayOf(today);
  const week = Array.from({ length: 7 }, (_, i) => { const d = addDaysIso(monday, i); return { label: d, done: (byDay.get(d) ?? 0) >= s.wordGoal, planned: s.wordDays.includes(i), today: d === today }; });
  return (
    <div className="page">
      {!(sp.train === "today" || sp.train === "all") && <StudyHead active="words" />}
      <WordsView
        words={words.map((w) => {
          const key = cardKeys.get(w.id);
          const details = key ? cardDetails.get(key) : null;
          return {
            id: w.id, word: w.word, translation: wordTranslations(w.translation).join("; ") || null, definition: w.definition,
            example: w.example, ownExample: w.ownExample, level: w.level, due: !w.nextReviewAt || w.nextReviewAt <= now,
            ipa: details?.ipa ?? null, enrich: !!key && (!w.definition?.trim() || !w.example?.trim() || !details),
          };
        })}
        goal={s.wordGoal} days={s.wordDays} remindAt={s.remindAt} doneToday={byDay.get(today) ?? 0} week={week} streak={streak}
        train={sp.train === "today" || sp.train === "all" ? sp.train : null} tab={sp.tab === "list" ? "list" : "overview"}
        editGoal={sp.goal === "1" && sp.tab !== "list"}
      />
    </div>
  );
}
