import { Dashboard } from "@/components/Dashboard";
import { requireUser } from "@/lib/auth/session";

export default async function TeacherHome({ searchParams }: { searchParams: Promise<{ d?: string }> }) {
  const { d } = await searchParams;
  return <Dashboard user={await requireUser("TEACHER")} role="TEACHER" day={/^\d{4}-\d{2}-\d{2}$/.test(d ?? "") ? d : undefined} />;
}
