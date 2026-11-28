"use server";

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { requireUser } from "../auth/session";
import { db } from "../db";
import { writeRoadmapStages } from "./stage-writes";
import { loadPlacementProposal, type PlacementConfirmation } from "./placement-proposal-data";

type Outcome = "applied" | "already-applied" | "stale";

export async function confirmPlacementProposal(
  studentId: string,
  roadmapId: string,
  expected: PlacementConfirmation,
): Promise<Outcome> {
  const teacher = await requireUser("TEACHER");
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const outcome = await db.$transaction(async (tx): Promise<Outcome> => {
        const route = await tx.roadmap.findFirst({
          where: { studentId, student: { teacherId: teacher.id } },
          orderBy: { createdAt: "desc" },
        });
        if (!route?.approvedAt || route.id !== roadmapId) return "stale";
        const proposal = await loadPlacementProposal(route, teacher.id, tx, true);
        if (!proposal || proposal.preview.blockedBy || proposal.preview.confirmation.result !== expected?.result) return "stale";
        const current = proposal.preview.confirmation;
        if (!proposal.preview.changes.length) {
          return current.before === expected.after && expected.before !== expected.after ? "already-applied" : "stale";
        }
        if (current.before !== expected.before || current.after !== expected.after) return "stale";

        const stages = JSON.parse(JSON.stringify(proposal.stages)) as Prisma.InputJsonValue;
        return await writeRoadmapStages(route, { stages }, tx) ? "applied" : "stale";
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      if (outcome !== "stale") {
        revalidatePath(`/teacher/students/${studentId}`);
        revalidatePath("/student/route");
      }
      return outcome;
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2034") throw error;
    }
  }
  return "stale";
}
