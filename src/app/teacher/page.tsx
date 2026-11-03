import { Dashboard } from "@/components/Dashboard";
import { requireUser } from "@/lib/auth/session";

export default async function TeacherHome() {
  return <Dashboard user={await requireUser("TEACHER")} role="TEACHER" />;
}
