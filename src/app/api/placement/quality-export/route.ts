import { getSessionUser } from "@/lib/auth/session";
import { isOwner } from "@/lib/placement/bank";
import { qualityCsv } from "@/lib/placement/quality";

export const dynamic = "force-dynamic";

/** Выгрузка ответов placement test для анализа качества заданий — только владельцу платформы, без имён. */
export async function GET() {
  const user = await getSessionUser();
  if (!user || user.role !== "TEACHER" || !isOwner(user.email)) return new Response("forbidden", { status: 403 });
  const csv = await qualityCsv();
  const day = new Date().toISOString().slice(0, 10);
  return new Response(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="placement-answers-${day}.csv"` } });
}
