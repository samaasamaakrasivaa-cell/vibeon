"use server";

import { revalidatePath } from "next/cache";
import { aiCtx } from "../ai/ctx";
import { run } from "../ai/gateway";
import { provider } from "../ai/providers";
import { requestWsWritingDraft } from "./ws-writing-draft";
import { requireUser } from "../auth/session";
import { saveWsTeacherDecision } from "./ws-teacher-write";

export async function changeWsTeacherAssessment(
  id: string,
  kind: Parameters<typeof saveWsTeacherDecision>[2],
  expected: Parameters<typeof saveWsTeacherDecision>[3],
  decision: Parameters<typeof saveWsTeacherDecision>[4],
) {
  const teacher = await requireUser("TEACHER");
  const result = await saveWsTeacherDecision(id, teacher.id, kind, expected, decision);
  if (result === "saved") revalidatePath(`/teacher/placement/${id}`);
  return result;
}

export async function requestWritingDraft(id: string, expected: Parameters<typeof requestWsWritingDraft>[2]) {
  const teacher = await requireUser("TEACHER");
  if (provider() === "mock" && process.env.PL_AI_MOCK !== "1") return "off";
  const result = await requestWsWritingDraft(id, teacher.id, expected, async (input, names) => {
    const context = await aiCtx(teacher);
    context.names = [...(context.names ?? []), ...names];
    return run("plscore", input, context);
  });
  if (result !== "stale") revalidatePath(`/teacher/placement/${id}`);
  return result;
}
