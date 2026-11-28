"use server";

import { requireUser } from "../auth/session";
import { confirmPlacementLevelForTeacher } from "./level-confirmation";

export async function confirmPlacementLevel(id: string, decision: Parameters<typeof confirmPlacementLevelForTeacher>[2]) {
  const teacher = await requireUser("TEACHER");
  return confirmPlacementLevelForTeacher(id, teacher.id, decision);
}
