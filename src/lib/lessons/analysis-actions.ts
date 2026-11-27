"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "../auth/session";
import { approveLessonAnalysis, generateLessonAnalysis, saveLessonObservation } from "./analysis";

function observationFrom(form: FormData) {
  return { text: form.get("observation"), selected: form.get("focus") };
}

export async function saveObservationAction(lessonId: string, form: FormData) {
  const teacher = await requireUser("TEACHER");
  const studentId = await saveLessonObservation(lessonId, teacher.id, observationFrom(form));
  if (!studentId) return;
  revalidatePath(`/teacher/lesson-analysis/${lessonId}`);
  revalidatePath(`/teacher/students/${studentId}`);
}

export async function generateAnalysisAction(lessonId: string, allowAi: boolean, form: FormData) {
  const teacher = await requireUser("TEACHER");
  await generateLessonAnalysis(lessonId, teacher.id, allowAi === true, form.has("observation") ? observationFrom(form) : undefined);
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
