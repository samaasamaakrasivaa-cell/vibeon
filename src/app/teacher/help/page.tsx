import { HelpPage } from "@/components/admin/HelpPage";
import { requireUser } from "@/lib/auth/session";

export const metadata = { title: "Помощь" };
export default async function TeacherHelp() { await requireUser("TEACHER"); return <HelpPage audience="teacher" />; }
