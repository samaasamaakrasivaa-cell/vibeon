import "server-only";
import { Prisma, type Roadmap } from "@prisma/client";
import { db } from "../db";
import { getT } from "../i18n/server";

type StageRevision = Pick<Roadmap, "id" | "approvedAt" | "builtAt" | "stages">;

export async function roadmapChanged() {
  const { lang } = await getT();
  return { ok: false, error: lang === "ru"
    ? "Маршрут изменился. Обновите страницу и повторите."
    : "The route changed. Refresh the page and try again." } as const;
}

// Every write based on a stage snapshot must fail if a different version was saved while it was being prepared.
export async function writeRoadmapStages(
  revision: StageRevision,
  data: Prisma.RoadmapUpdateManyMutationInput & { stages: Prisma.InputJsonValue },
  client: Pick<Prisma.TransactionClient, "roadmap"> = db,
) {
  const { id, approvedAt, builtAt, stages } = revision;
  const result = await client.roadmap.updateMany({
    where: { id, approvedAt, builtAt, stages: { equals: stages === null ? Prisma.JsonNull : stages } },
    data,
  });
  return result.count === 1;
}
