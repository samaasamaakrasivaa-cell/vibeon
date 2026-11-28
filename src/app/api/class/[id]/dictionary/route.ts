import { NextResponse, type NextRequest } from "next/server";
import { searchDictionary } from "@/lib/ai/dictionary-lookup";
import { getSessionUser } from "@/lib/auth/session";
import { classAccess } from "@/lib/live/access";

const errorStatus = { input: 400, limit: 429, unavailable: 503 };

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "auth" }, { status: 401 });

  const { id } = await params;
  const access = await classAccess(id, user);
  const teacherId = access?.lesson.teacherId;
  if (!access || !teacherId) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const names = [user.name, user.lastName, ...access.slot.flatMap(({ student }) => [student?.name, student?.lastName])];
  const result = await searchDictionary(body?.query, { userId: user.id, teacherId, names });
  return NextResponse.json(result, { status: "error" in result ? errorStatus[result.error] : 200 });
}
