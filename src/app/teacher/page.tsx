import { Dashboard } from "@/components/Dashboard";
import { NewsBanner } from "@/components/teacher/NewsBanner";
import { NextLessonCountdown } from "@/components/teacher/NextLessonCountdown";
import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";

async function TeacherNextLesson({ teacherId, timezone }: { teacherId: string; timezone: string }) {
  const now = new Date();
  const next = await db.lessonInstance.findFirst({
    where: { teacherId, status: "PLANNED", startsAt: { gt: now } },
    orderBy: { startsAt: "asc" },
    select: { startsAt: true },
  });
  return <NextLessonCountdown startsAt={next?.startsAt.getTime() ?? null} initialNow={now.getTime()} timezone={timezone} />;
}

export default async function TeacherHome({ searchParams }: { searchParams: Promise<{ d?: string }> }) {
  const { d } = await searchParams;
  const user = await requireUser("TEACHER");
  // сверху — новое на платформе (если учитель ещё не открывал новости)
  return (
    <Dashboard
      user={user}
      role="TEACHER"
      day={/^\d{4}-\d{2}-\d{2}$/.test(d ?? "") ? d : undefined}
      top={
        <>
          <NewsBanner userId={user.id} />
          <TeacherNextLesson teacherId={user.id} timezone={user.timezone} />
        </>
      }
    />
  );
}
