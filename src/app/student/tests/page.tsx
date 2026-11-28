import Link from "next/link";
import { Icon } from "@/components/Icon";
import { SectionTabs, StudyHead } from "@/components/student/SectionTabs";
import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getT } from "@/lib/i18n/server";
import { studentTests } from "@/lib/student/tests";

export const metadata = { title: "Моё тестирование" };
export const dynamic = "force-dynamic";

const status = {
  assigned: ["blue", "stl.assigned"],
  active: ["blue", "stl.inProgress"],
  submitted: ["orange", "stl.checking"],
  reviewed: ["green", "stl.reviewed"],
} as const;

export default async function MyTests({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const me = await requireUser("STUDENT");
  const { t, lang } = await getT();
  const student = await db.student.findUnique({ where: { userId: me.id }, select: { id: true } });
  if (!student) return null;
  const tests = await studentTests(student.id);
  const tab = (await searchParams).tab === "completed" ? "completed" : "assigned";
  const rows = tests[tab];
  const fmt = new Intl.DateTimeFormat(lang === "ru" ? "ru-RU" : "en-GB", {
    day: "numeric", month: "short", year: "numeric", timeZone: me.timezone,
  });
  return (
    <div className="page">
      <StudyHead active="tests" />
      <SectionTabs items={[
        { href: "/student/tests", label: t("stl.assigned"), active: tab === "assigned", count: tests.assigned.length },
        { href: "/student/tests?tab=completed", label: t("stl.completed"), active: tab === "completed", count: tests.completed.length },
      ]} />
      {rows.length > 0 ? <ul className="list m-0 p-0">
        {rows.map((test) => {
          const [color, label] = status[test.state];
          return (
            <li key={test.id} className="row flex-wrap">
              <span className="pill violet"><Icon name="target" size="sm" /></span>
              <div className="min-w-0 grow basis-[150px]">
                <div className="t">{t(test.title)}</div>
                <time className="s" dateTime={test.at.toISOString()}>{fmt.format(test.at)}</time>
              </div>
              <span className={`pill ${color}`}>{t(label)}</span>
              <div className="study-actions flex flex-wrap gap-2">
                {test.start && <Link href={test.start} className="btn primary sm">{t(test.state === "active" ? "pl.continue" : "pl.start")}</Link>}
                {test.result && <Link href={test.result} prefetch={false} className="btn secondary sm">{t("stl.openResult")}</Link>}
              </div>
            </li>
          );
        })}
      </ul> : <div className="card"><p className="hint m-0">{t(tab === "assigned" ? "stl.noAssigned" : "stl.noCompleted")}</p></div>}
    </div>
  );
}
