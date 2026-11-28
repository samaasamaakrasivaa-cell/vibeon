import "server-only";
import { createHash } from "node:crypto";
import { Prisma, type Roadmap } from "@prisma/client";
import { db } from "../db";
import { confirmedPlacementSchema, planPlacementUpdate } from "./placement-proposal";
import { roadmapHours } from "./hours";
import type { Stage } from "./cefr";

const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value, (_, item) => {
  if (!item || typeof item !== "object" || Array.isArray(item)) return item;
  return Object.fromEntries(Object.entries(item).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
})).digest("hex");

export type PlacementConfirmation = { result: string; before: string; after: string };

export async function loadPlacementProposal(
  roadmap: Pick<Roadmap, "id" | "studentId" | "approvedAt" | "createdAt" | "startHours" | "stages">,
  teacherId: string,
  client: Prisma.TransactionClient = db,
  lockSource = false,
) {
  if (!roadmap.approvedAt) return null;
  // Read only the handoff, without loading private notes, answers, report text or publication drafts.
  const [candidate] = await client.$queryRaw<{ id: string; result: unknown }[]>`
    SELECT id, review -> 'roadmapResultV1' AS result FROM "PlacementAttempt"
    WHERE "studentId" = ${roadmap.studentId} AND "teacherId" = ${teacherId} AND mode = 'student'
      AND review ? 'roadmapResultV1'
    ORDER BY (review -> 'roadmapResultV1' ->> 'confirmedAt') DESC NULLS FIRST, id DESC
    LIMIT 1 ${lockSource ? Prisma.sql`FOR SHARE` : Prisma.empty}
  `;
  const parsed = confirmedPlacementSchema.safeParse(candidate?.result);
  if (!parsed.success || parsed.data.attemptId !== candidate.id) return null;

  const [done, active, checkpoints] = await Promise.all([
    roadmapHours(roadmap, client),
    client.lessonInstance.findMany({
      where: { studentId: roadmap.studentId, status: "PLANNED", startedAt: { not: null }, finishedAt: null, isTrial: false },
      select: { durationMin: true },
    }),
    client.checkpoint.findMany({
      where: { studentId: roadmap.studentId, OR: [{ roadmapId: roadmap.id }, { roadmapId: null }], kind: { in: ["slice", "final"] } },
      select: { id: true, stage: true, status: true, roadmapId: true, source: true, kind: true },
      orderBy: { id: "asc" },
    }),
  ]);
  const protectedHours = done + active.reduce((sum, lesson) => sum + lesson.durationMin, 0) / 60;
  const raw = Array.isArray(roadmap.stages) ? roadmap.stages as Stage[] : [];
  const source = parsed.data;
  const plan = planPlacementUpdate(raw, protectedHours, checkpoints, source);
  const result = digest(source);
  const routeStamp = (stages: Stage[]) => digest({ result, checkpoints, id: roadmap.id, approvedAt: roadmap.approvedAt, stages });
  const confirmation: PlacementConfirmation = { result, before: routeStamp(raw), after: routeStamp(plan.stages) };
  const { stages, ...details } = plan;
  return { stages, preview: { ...details, source, confirmation } };
}

export type PlacementProposal = NonNullable<Awaited<ReturnType<typeof loadPlacementProposal>>>["preview"];
