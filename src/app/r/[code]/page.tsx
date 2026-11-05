import { redirect } from "next/navigation";

/** Короткая ссылка восстановления доступа /r/код (её даёт преподаватель) → «Новый пароль». */
export default async function Short({ params }: { params: Promise<{ code: string }> }) {
  redirect(`/reset?token=${encodeURIComponent((await params).code.toLowerCase())}`);
}
