import { redirect } from "next/navigation";

/** Короткая ссылка-приглашение /i/код → страница приглашения. */
export default async function Short({ params }: { params: Promise<{ code: string }> }) {
  redirect(`/invite/${encodeURIComponent((await params).code.toLowerCase())}`);
}
