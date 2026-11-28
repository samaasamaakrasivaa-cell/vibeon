import "server-only";
import { db } from "../db";
import type { DictKey } from "../i18n/dict";
import { lastPublication, storedReport } from "../placement/report-publication";

type TestState = "assigned" | "active" | "submitted" | "reviewed";
type TestItem = {
  id: string;
  title: DictKey;
  state: TestState;
  at: Date;
  start?: string;
  result?: string;
};

export async function studentTests(studentId: string) {
  const checkpoints = await db.checkpoint.findMany({
    where: {
      studentId,
      OR: [
        { kind: "entry", status: { in: ["assigned", "review", "done"] } },
        { kind: { in: ["slice", "final"] }, status: { in: ["assigned", "done"] } },
      ],
    },
    select: { id: true, status: true, source: true, kind: true, assignedAt: true, takenAt: true },
  });
  const entryIds = new Set(checkpoints.filter((checkpoint) => checkpoint.kind === "entry").map(({ id }) => id));
  const [attempts, links] = await Promise.all([
    db.placementAttempt.findMany({
      where: { studentId, mode: "student", status: { in: ["new", "active", "submitted", "reviewed"] } },
      select: { id: true, checkpointId: true, status: true, track: true, showResult: true, review: true, createdAt: true, submittedAt: true, reviewedAt: true },
    }),
    db.placementAttempt.findMany({
      where: { checkpointId: { in: [...entryIds] } }, select: { checkpointId: true },
    }),
  ]);
  const paired = new Set(links.map(({ checkpointId }) => checkpointId));
  const placement: TestItem[] = attempts.flatMap((attempt) => {
    const checkpointId = attempt.checkpointId;
    if (checkpointId && !entryIds.has(checkpointId)) return [];
    const state = attempt.status === "new" ? "assigned" : attempt.status as Exclude<TestState, "assigned">;
    const ongoing = state === "assigned" || state === "active";
    const report = storedReport(attempt.review);
    const snapshot = lastPublication(report);
    const published = snapshot?.schema === 1 && report.sent === true && report.resultVisible === true && state !== "assigned";
    const visible = (!snapshot || snapshot.schema === 1) && (published || (state === "reviewed" && attempt.showResult));
    return [{
      id: attempt.id, title: attempt.track === "teen" ? "plt.title" : "pl.title", state,
      at: ongoing ? attempt.createdAt : attempt.reviewedAt ?? attempt.submittedAt ?? attempt.createdAt,
      start: ongoing ? `/placement/${attempt.id}` : undefined,
      result: checkpointId && visible ? `/student/test/${checkpointId}` : undefined,
    }];
  });
  const checkpointsWithoutAttempt: TestItem[] = checkpoints.flatMap((checkpoint) => {
    if (paired.has(checkpoint.id) || checkpoint.source === "placement" || checkpoint.status === "review") return [];
    const assigned = checkpoint.status === "assigned";
    if (assigned && checkpoint.source !== "test") return [];
    const href = `/student/test/${checkpoint.id}`;
    return [{
      id: checkpoint.id,
      title: checkpoint.kind === "entry" ? "rm.entry" : checkpoint.kind === "final" ? "rt.finalTest" : "rt.sliceTest",
      state: assigned ? "assigned" : "reviewed",
      at: checkpoint.takenAt ?? checkpoint.assignedAt,
      start: assigned ? href : undefined,
      result: assigned ? undefined : href,
    }];
  });
  const tests = [...placement, ...checkpointsWithoutAttempt].sort((a, b) => b.at.getTime() - a.at.getTime() || b.id.localeCompare(a.id));
  return { assigned: tests.filter((test) => test.start), completed: tests.filter((test) => !test.start) };
}
