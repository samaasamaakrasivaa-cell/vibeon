"use client";
import { useT } from "@/lib/i18n/client";
import type { Moment } from "@/lib/teacher/moments";
import { GiveLink, useMomentText, whenLabel } from "./MomentsCard";

/** Анкета → «Вместе»: вехи и поводы ученика — с кнопкой «Выдать награду». */
export function StudentMoments({ moments }: { moments: Moment[] }) {
  const { t } = useT();
  const text = useMomentText();
  return (
    <ul className="molist sm mt-3">
      {moments.map((m) => {
        const x = text(m);
        return (
          <li key={m.id} className={`mo-${m.kind} ${m.days === 0 ? "now" : ""}`}>
            <div className="grow min-w-0"><b className="block">{x.what.charAt(0).toUpperCase() + x.what.slice(1)}</b><span className="small muted">{whenLabel(t, m.days)} · {x.hint}</span></div>
            <GiveLink m={m} small />
          </li>
        );
      })}
    </ul>
  );
}
