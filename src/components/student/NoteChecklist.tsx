"use client";
import { useState } from "react";
import { setStudentNote } from "@/lib/student/actions";

/** Заметки ученика после урока: каждая строка — пункт с галочкой («[x] » в начале строки = сделано). */
export function NoteChecklist({ lessonId, title, text }: { lessonId: string; title: string; text: string }) {
  const [lines, setLines] = useState(() => text.split("\n").filter((l) => l.trim()));
  const toggle = (i: number) => {
    const next = lines.map((l, j) => (j !== i ? l : l.startsWith("[x] ") ? l.slice(4) : `[x] ${l}`));
    setLines(next);
    setStudentNote(lessonId, next.join("\n"));
  };
  return (
    <div className="tile" style={{ background: "var(--violet-bg)" }}>
      <div className="small mb-2 font-semibold text-violet">{title}</div>
      <div className="flex flex-col gap-2">
        {lines.map((l, i) => (
          <label key={i} className="flex items-start gap-2">
            <input type="checkbox" className="check mt-0.5" checked={l.startsWith("[x] ")} onChange={() => toggle(i)} />
            <span className={l.startsWith("[x] ") ? "text-text3 line-through" : ""}>{l.replace(/^\[x\] /, "")}</span>
          </label>
        ))}
      </div>
    </div>
  );
}
