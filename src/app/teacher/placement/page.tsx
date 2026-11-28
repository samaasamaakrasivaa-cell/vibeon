import { PlacementPanel } from "@/components/placement/PlacementPanel";
import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { getT } from "@/lib/i18n/server";
import { initials } from "@/lib/invite";
import { isOwner, TEEN_READY } from "@/lib/placement/bank";

export const metadata = { title: "Тесты" };

function ageOf(birthday: Date | null) {
  if (!birthday) return null;
  const now = new Date();
  const beforeBirthday = now.getMonth() < birthday.getMonth()
    || (now.getMonth() === birthday.getMonth() && now.getDate() < birthday.getDate());
  return now.getFullYear() - birthday.getFullYear() - Number(beforeBirthday);
}

export default async function PlacementPage() {
  const { t } = await getT();
  const teacher = await requireUser("TEACHER");
  const [students, attempts, links] = await Promise.all([
    db.student.findMany({ where: { teacherId: teacher.id, archivedAt: null }, orderBy: { name: "asc" }, select: { id: true, name: true, lastName: true, birthday: true } }),
    db.placementAttempt.findMany({
      where: { teacherId: teacher.id },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      select: {
        id: true, mode: true, status: true, level: true, track: true, guestName: true,
        createdAt: true, submittedAt: true, reviewedAt: true,
        student: { select: { name: true, lastName: true } },
      },
    }),
    db.placementLink.findMany({ where: { teacherId: teacher.id, active: true }, orderBy: { createdAt: "desc" }, select: { track: true, code: true, showResult: true } }),
  ]);
  const owner = isOwner(teacher.email);
  return (
    <div className="page">
      <h1>{t("pl.tab")}</h1>
      <p className="muted mt-2 mb-6">{t("pl.tabLead")}</p>
      <PlacementPanel
        owner={owner} teen={TEEN_READY || owner} origin={env.appUrl} timeZone={teacher.timezone}
        links={{ adult: links.find((link) => link.track === "adult"), teen: links.find((link) => link.track === "teen") }}
        ages={Object.fromEntries(students.map((student) => [student.id, ageOf(student.birthday)]))}
        students={students.map((student) => ({ id: student.id, name: [student.name, student.lastName].filter(Boolean).join(" "), initials: initials(student.name, student.lastName) }))}
        rows={attempts.map((attempt) => ({
          id: attempt.id, mode: attempt.mode, status: attempt.status, level: attempt.level, track: attempt.track,
          who: attempt.mode === "student" ? [attempt.student?.name, attempt.student?.lastName].filter(Boolean).join(" ") : attempt.mode === "self" ? t("pl.you") : attempt.guestName ?? "",
          createdAt: attempt.createdAt.getTime(), submittedAt: attempt.submittedAt?.getTime(), reviewedAt: attempt.reviewedAt?.getTime(),
        }))}
      />
    </div>
  );
}
