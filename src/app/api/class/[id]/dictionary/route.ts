import { NextResponse, type NextRequest } from "next/server";
import { dictionaryQuery } from "@/lib/ai/dictionary";
import { AiError, lookupDictionary, scrub } from "@/lib/ai/gateway";
import { getSessionUser } from "@/lib/auth/session";
import { classAccess } from "@/lib/live/access";
import { withLock } from "@/lib/live/bus";
import { rateLimit } from "@/lib/rate-limit";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "auth" }, { status: 401 });

  const { id } = await params;
  const access = await classAccess(id, user);
  const teacherId = access?.lesson.teacherId;
  if (!access || !teacherId) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (!(await rateLimit(`dictionary:${user.id}`, 20)) || !(await rateLimit(`dictionary-teacher:${teacherId}`, 60))) {
    return NextResponse.json({ error: "limit" }, { status: 429 });
  }

  const body = await req.json().catch(() => null);
  const query = dictionaryQuery(body?.query);
  const names = [user.name, user.lastName, ...access.slot.flatMap(({ student }) => [student?.name, student?.lastName])];
  if (!query || scrub(query, names) !== query) return NextResponse.json({ error: "input" }, { status: 400 });

  try {
    const translations = await withLock(`dictionary:${query}`, () => lookupDictionary(query, { userId: user.id, teacherId }));
    return NextResponse.json({ translations });
  } catch (error) {
    if (error instanceof AiError && error.code === "limit") {
      return NextResponse.json({ error: "limit" }, { status: 429 });
    }
    return NextResponse.json({ error: "unavailable" }, { status: 503 });
  }
}
