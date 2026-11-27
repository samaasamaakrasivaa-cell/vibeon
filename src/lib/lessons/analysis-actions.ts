"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "../auth/session";
import { approveLessonAnalysis, generateLessonAnalysis } from "./analysis";

export async function generateAnalysisAction(lessonId: string) {
  const teacher = await requireUser("TEACHER");
  await generateLessonAnalysis(lessonId, teacher.id);
  revalidatePath(`/teacher/lesson-analysis/${lessonId}`);
}

export async function approveAnalysisAction(lessonId: string, publish: boolean) {
  const teacher = await requireUser("TEACHER");
  if (!await approveLessonAnalysis(lessonId, teacher.id, publish)) return;
  revalidatePath(`/teacher/lesson-analysis/${lessonId}`);
  if (publish) {
    revalidatePath("/student/progress");
    revalidatePath(`/student/lesson-analysis/${lessonId}`);
  }
}
