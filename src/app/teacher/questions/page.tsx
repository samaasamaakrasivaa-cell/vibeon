import { redirect } from "next/navigation";

/** Вопросы учеников теперь — раздел «На проверку». */
export default async function Questions({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const tab = (await searchParams).tab;
  redirect(`/teacher/homework?kind=questions${tab ? `&tab=${tab}` : ""}`);
}
