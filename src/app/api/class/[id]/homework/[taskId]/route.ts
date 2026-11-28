import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth/session";
import { changeHomeworkResubmission, readHomeworkResubmission } from "@/lib/homework-resubmission";
import { classAccess } from "@/lib/live/access";
import { publish } from "@/lib/live/bus";
import { rateLimit } from "@/lib/rate-limit";

type Context = { params: Promise<{ id: string; taskId: string }> };
const reply = (status: number) => NextResponse.json({ ok: status === 200 }, { status });

async function access({ params }: Context) {
  const { id, taskId } = await params;
  const user = await getSessionUser();
  if (!user) return { status: 401 } as const;
  const acc = await classAccess(id, user);
  // The group class can open on another member's URL. This endpoint addresses one exact lesson.
  if (!acc?.lesson.studentId || !acc.lesson.teacherId || acc.lesson.id !== id) return { status: 403 } as const;
  if (!(await rateLimit(`homework:${user.id}`, 180, 60))) return { status: 429 } as const;
  return {
    status: 200, role: acc.role, hostId: acc.host.id,
    target: { lessonInstanceId: id, taskId, studentId: acc.lesson.studentId, teacherId: acc.lesson.teacherId },
  } as const;
}

export async function GET(_req: NextRequest, context: Context) {
  const acc = await access(context);
  if (acc.status !== 200) return reply(acc.status);
  const data = await readHomeworkResubmission(acc.target, acc.role === "teacher");
  return data ? NextResponse.json(data, { headers: { "Cache-Control": "private, no-store" } }) : reply(404);
}

const text = z.string();
const draftPayload = z.object({
  val: z.record(text).optional(),
  text: text.optional(),
  checked: z.boolean().optional(),
  hist: z.record(z.array(z.object({ v: text, ok: z.boolean() })).max(10)).optional(),
  tries: z.record(z.number().int().nonnegative()).optional(),
  rec: z.object({
    transcript: text.trim().min(1),
    check: z.object({
      source: text.optional(), corrected: text, summary: text,
      notes: z.array(z.object({ from: text, to: text, why: text })),
      verdict: z.enum(["ok", "partly", "wrong"]).optional(),
    }).optional(),
  }).nullable().optional(),
}).strict();
const revision = z.number().int().nonnegative().safe();
const command = z.discriminatedUnion("type", [
  z.object({ type: z.literal("start"), revision }),
  z.object({ type: z.literal("save"), revision, payload: draftPayload }),
  z.object({ type: z.literal("submit"), revision }),
]);

export async function POST(req: NextRequest, context: Context) {
  const acc = await access(context);
  if (acc.status !== 200) return reply(acc.status);
  if (acc.role !== "student") return reply(403);
  const raw = await req.text();
  if (raw.length > 120_000) return reply(413);
  let body: unknown;
  try { body = JSON.parse(raw); } catch { return reply(400); }
  const parsed = command.safeParse(body);
  if (!parsed.success) return reply(400);
  const change = parsed.data;
  const result = await changeHomeworkResubmission(acc.target, change);
  if (result.status !== 200) return reply(result.status);
  if (change.type !== "save") publish(`class:${acc.hostId}:teacher`, "homeworkRevision", {});
  return NextResponse.json({ ok: true, revision: result.revision });
}
