# VOC-09 · Teacher vocabulary activity

Read-only views: Students → Profiles (aggregate of active students of the authenticated teacher), and the teacher's student card → Progress (one owned student, including archive). Both use the same server-only teacherVocabularyStats helper; the teacher identity comes from requireUser("TEACHER"). The individual page additionally retains its existing ownership check. Every aggregate query is scoped by the student relation and teacher ID; a consistent read transaction prevents inconsistent totals.

- Word: current saved cards, split by presence of a recorded non-empty sourceLessonId. Missing source is not evidence of manual addition or another particular source. Last addition is the latest createdAt of retained cards, shown in the teacher's time zone.
- WordPractice: sum of positive recorded daily counts, including repeated processing of the same card. Latest practice is the latest recorded day in the student's calendar (not an exact instant; across students it is a calendar date). No invented session count, mastery, or exact training timestamp.
- Local Classroom/Homework word cards that do not write WordPractice are not counted. No change to word training, goals, progress, privacy rights, schema or historical data.
- Empty counts are zero; missing dates show No records / Нет записей.

The existing isolated PR CI smoke job exercises the actual teacher pages on synthetic data: two teachers, student role, active/archived/foreign students, empty records, missing source, repeated daily count, RU/EN and 320px mobile and desktop card layout in a preinstalled headless browser. No external service credentials or production database are used. The test refuses to run outside the isolated GitHub Actions database URL.
