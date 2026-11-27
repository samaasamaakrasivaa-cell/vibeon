import { Dashboard } from "@/components/Dashboard";
import { NewsBanner } from "@/components/teacher/NewsBanner";
import { requireUser } from "@/lib/auth/session";

export default async function TeacherHome({ searchParams }: { searchParams: Promise<{ d?: string }> }) {
  const { d } = await searchParams;
  const user = await requireUser("TEACHER");
  // сверху — новое на платформе (если учитель ещё не открывал новости)
  return (
    <Dashboard
      user={user}
      role="TEACHER"
      day={/^\d{4}-\d{2}-\d{2}$/.test(d ?? "") ? d : undefined}
      top={<NewsBanner userId={user.id} />}
    />
  );
}
