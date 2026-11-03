import { Dashboard } from "@/components/Dashboard";
import { getCurrentUser } from "@/lib/current-user";

export default async function StudentHome() {
  return <Dashboard user={await getCurrentUser("STUDENT")} role="STUDENT" />;
}
