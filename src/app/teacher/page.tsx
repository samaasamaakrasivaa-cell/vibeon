import { Dashboard } from "@/components/Dashboard";
import { getCurrentUser } from "@/lib/current-user";

export default async function TeacherHome() {
  return <Dashboard user={await getCurrentUser("TEACHER")} role="TEACHER" />;
}
