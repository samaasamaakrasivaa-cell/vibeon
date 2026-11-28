import type { VocabularyStats } from "@/lib/teacher/vocabulary-stats";

type Props = {
  stats: VocabularyStats;
  scope: "active" | "student";
  lang: "ru" | "en";
  timezone: string;
};

export function VocabularyStatsCard({ stats, scope, lang, timezone }: Props) {
  const ru = lang === "ru";
  const loc = ru ? "ru-RU" : "en-GB";
  const empty = ru ? "Нет записей" : "No records";
  const added = stats.lastAddedAt?.toLocaleDateString(loc, { timeZone: timezone, year: "numeric", month: "short", day: "numeric" });
  const items: { key: string; label: string; value: string | number; display?: string }[] = [
    ...(scope === "active" ? [{ key: "students", label: ru ? "Активных учеников" : "Active students", value: stats.students }] : []),
    { key: "words", label: ru ? "Карточек в словаре" : "Vocabulary cards", value: stats.words },
    { key: "linked", label: ru ? "С указанным уроком" : "With a recorded lesson", value: stats.linked },
    { key: "unlinked", label: ru ? "Урок не указан" : "No lesson recorded", value: stats.unlinked },
    { key: "practiced", label: ru ? "Карточек обработано в тренировках" : "Cards processed in practice", value: stats.practiced },
    { key: "lastPracticeDay", label: ru ? "Последняя записанная дата тренировки" : "Latest recorded practice date", value: stats.lastPracticeDay ?? "", display: stats.lastPracticeDay ?? empty },
    { key: "lastAddedAt", label: ru ? "Последнее добавление среди сохранённых карточек" : "Latest addition among saved cards", value: added ?? "", display: added ?? empty },
  ];
  return (
    <section className="card mb-4" data-vocabulary-stats={scope} style={{ minWidth: 0, overflowWrap: "anywhere" }}>
      <h3 className="mt-0 mb-2">{scope === "active" ? (ru ? "Словари активных учеников" : "Active students' vocabulary") : (ru ? "Словарь и тренировки" : "Vocabulary and practice")}</h3>
      <dl className="m-0 grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 10rem), 1fr))" }}>
        {items.map((item) => (
          <div key={item.key} className="min-w-0">
            <dt className="small muted">{item.label}</dt>
            <dd className="m-0 font-semibold" data-vocab-metric={item.key} data-value={item.value}>
              {item.display ?? (typeof item.value === "number" ? item.value.toLocaleString(loc) : item.value)}
            </dd>
          </div>
        ))}
      </dl>
      <p className="hint mt-3 mb-0">{ru
        ? "По имеющимся записям за всё время. Повторные обработки карточки учитываются повторно; это не число уникальных слов или занятий. Даты тренировок записаны по календарю ученика. Неуказанный урок не означает ручное добавление."
        : "From all available records. Repeated card processing is counted again; this is not a count of unique words or sessions. Practice dates use the student's calendar. An unrecorded lesson does not imply manual addition."}</p>
    </section>
  );
}
