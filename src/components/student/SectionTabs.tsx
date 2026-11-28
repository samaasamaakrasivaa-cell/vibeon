import Link from "next/link";
import { getT } from "@/lib/i18n/server";

type Item = { href: string; label: string; active: boolean; count?: number };

/** Вкладки внутри раздела кабинета ученика (как вкладки анкеты у учителя). */
export function SectionTabs({ items }: { items: Item[] }) {
  return (
    <nav className="tabsbar fit mb-6">
      {items.map((x) => (
        <Link key={x.href} href={x.href} aria-current={x.active ? "page" : undefined}>
          {x.label}{!!x.count && <span className="tabcount">{x.count}</span>}
        </Link>
      ))}
    </nav>
  );
}

// Разделы меню ученика, собранные из нескольких страниц: заголовок раздела + вкладки.
export type StudyTab = "lessons" | "words" | "tests";
export type ChatTab = "teacher" | "answers";
export type ProgressTab = "topics" | "stats" | "route" | "tests" | "awards" | "feedback";

export async function StudyHead({ active }: { active: StudyTab }) {
  const { t } = await getT();
  return (
    <>
      <h1 className="mb-4">{t("nav.study")}</h1>
      <SectionTabs items={[
        { href: "/student/lessons", label: t("nav.lessons"), active: active === "lessons" },
        { href: "/student/words", label: t("nav.words"), active: active === "words" },
        { href: "/student/tests", label: t("stl.myTests"), active: active === "tests" },
      ]} />
    </>
  );
}

export async function ChatHead({ active, answers = 0, aside }: { active: ChatTab; answers?: number; aside?: React.ReactNode }) {
  const { t } = await getT();
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><h1 className="m-0">{t("nav.chat")}</h1>{aside}</div>
      <SectionTabs items={[
        { href: "/student/messages", label: t("chat.teacherTab"), active: active === "teacher" },
        { href: "/student/questions", label: t("chat.answersTab"), active: active === "answers", count: answers },
      ]} />
    </>
  );
}

export async function ProgressHead({ active }: { active: ProgressTab }) {
  const { t } = await getT();
  const P = "/student/progress";
  return (
    <>
      <h1 className="mb-4">{t("nav.myProgress")}</h1>
      <SectionTabs items={[
        { href: P, label: t("pg.tab.topics"), active: active === "topics" },
        { href: `${P}?tab=stats`, label: t("pg.tab.stats"), active: active === "stats" },
        { href: "/student/route", label: t("pg.tab.route"), active: active === "route" },
        { href: `${P}?tab=tests`, label: t("pg.tab.tests"), active: active === "tests" },
        { href: `${P}?tab=awards`, label: t("pg.tab.awards"), active: active === "awards" },
        { href: `${P}?tab=feedback`, label: t("pg.tab.feedback"), active: active === "feedback" },
      ]} />
    </>
  );
}
