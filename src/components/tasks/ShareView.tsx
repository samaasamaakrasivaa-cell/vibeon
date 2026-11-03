"use client";
import { useT } from "@/lib/i18n/client";
import { Brand, LogoMark } from "../Logo";
import { TaskCard, type TaskData } from "./TaskView";

export function ShareView({ title, course, groups, homework, words }: { title: string; course: string; groups: { title: string; tasks: TaskData[] }[]; homework: TaskData[]; words: TaskData[] }) {
  const { t } = useT();
  let n = -1;
  const list = (tasks: TaskData[]) => tasks.map((task) => <TaskCard key={task.id} task={task} index={task.type === "divider" ? -1 : ++n} />);
  return (
    <>
      <header className="apptop"><a href="/" className="atl"><LogoMark /><Brand /></a><span className="small muted">{t("shr.guest")}</span></header>
      <main className="main"><div className="page" style={{ maxWidth: 820 }}>
        <div className="small muted">{course}</div>
        <h1 className="mb-2">{title}</h1>
        <div className="alert ok mb-6" style={{ background: "var(--accent-bg)", color: "var(--accent-text)" }}>{t("shr.note")}</div>
        {groups.map((g) => <section key={g.title} className="mb-8"><h2 className="mb-3">{g.title}</h2>{list(g.tasks)}</section>)}
        {homework.length > 0 && <section className="mb-8"><h2 className="mb-3">{t("nav.homework")}</h2>{list(homework)}</section>}
        {words.length > 0 && <section className="mb-8"><h2 className="mb-3">{t("bld.newWords")}</h2>{list(words)}</section>}
      </div></main>
    </>
  );
}
