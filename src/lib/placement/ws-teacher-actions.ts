"use server";

import { revalidatePath } from "next/cache";
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
