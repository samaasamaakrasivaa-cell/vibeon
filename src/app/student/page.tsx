import { Dashboard } from "@/components/Dashboard";
import { requireUser } from "@/lib/auth/session";

export default async function StudentHome() {
  return <Dashboard user={await requireUser("STUDENT")} role="STUDENT" />;
}
