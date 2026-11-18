import { redirect } from "next/navigation";

/** Старый адрес «Помощь и новости» → «О платформе». */
export default function OldHelp() { redirect("/teacher/platform"); }
