"use client";

import { useState } from "react";
import { planCourseOutline } from "@/lib/ai/actions";
import { useT } from "@/lib/i18n/client";
import { OUTLINE_FILE_LIMIT, OUTLINE_SOURCE_LIMIT, type CourseOutlineEntry } from "@/lib/tasks/course-outline";
import { importCourseOutline } from "@/lib/teacher/courses";
import { extractFile } from "../ai/BookImport";
import { randomId } from "../builder/rid";
import { Dialog } from "../Dialog";
import { Icon } from "../Icon";

const formats = ".pdf,.docx";
const extractionErrors = ["type", "size", "limit", "tariff", "off"] as const;
const textFields = [
  ["topics", "crs.outline.topics"],
  ["grammar", "crs.outline.grammar"],
  ["vocabulary", "crs.outline.vocabulary"],
  ["skills", "crs.outline.skills"],
] as const;

type DraftLesson = CourseOutlineEntry & { key: string };
type DraftUnit = CourseOutlineEntry & { key: string; lessons: DraftLesson[] };
type Draft = { ticket: string; units: DraftUnit[] };

function OutlineFields({ entry, titleLimit, onChange }: {
  entry: CourseOutlineEntry;
  titleLimit: number;
  onChange: (values: Partial<CourseOutlineEntry>) => void;
}) {
  const { t } = useT();
  return (
    <div className="mt-2 grid gap-2 sm:grid-cols-2">
      <label className="field sm:col-span-2">
        <span className="flabel">{t("crs.title")}</span>
        <input className="input" required value={entry.title} maxLength={titleLimit}
          onChange={(event) => onChange({ title: event.currentTarget.value })} />
      </label>
      {textFields.map(([field, label]) => (
        <label className="field" key={field}>
          <span className="flabel">{t(label)}</span>
          <textarea className="textarea" rows={2} maxLength={1000} value={entry[field]}
            onChange={(event) => onChange({ [field]: event.currentTarget.value })} />
        </label>
      ))}
    </div>
  );
}

export function CourseOutlineImport({ courseId, onClose, onSaved }: {
  courseId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useT();
  const [files, setFiles] = useState<File[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState<"reading" | "planning" | "saving" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const analyze = async () => {
    if (busy || !files.length) return;
    if (files.length > OUTLINE_FILE_LIMIT) {
      setError(t("crs.outline.fileLimit", { n: OUTLINE_FILE_LIMIT }));
      return;
    }
    setError(null);
    setBusy("reading");
    try {
      const pages: string[] = [];
      for (const file of files) {
        try {
          const page = (await extractFile(file, "course-outline")).trim();
          if (!page) {
            setError(`${file.name} · ${t("ai.err.empty")}`);
            return;
          }
          pages.push(page);
        } catch (problem) {
          if (problem instanceof Error && problem.message === "outlineText") {
            setError(`${file.name} · ${t("crs.outline.localText")}`);
            return;
          }
          const code = extractionErrors.find((code) => problem instanceof Error && problem.message === code);
          setError(`${file.name} · ${code ? t(`ai.err.${code}`) : t("ai.err.fail")}`);
          return;
        }
      }
      const source = pages.join("\n\n");
      if (source.length > OUTLINE_SOURCE_LIMIT) {
        setError(t("crs.outline.sourceLimit"));
        return;
      }
      setBusy("planning");
      const result = await planCourseOutline(courseId, source);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setDraft({
        ticket: result.draft,
        units: result.outline.units.map((unit) => ({
          ...unit,
          key: randomId(),
          lessons: unit.lessons.map((lesson) => ({ ...lesson, key: randomId() })),
        })),
      });
    } catch {
      setError(t("ai.err.fail"));
    } finally {
      setBusy(null);
    }
  };

  const updateUnit = (key: string, update: (unit: DraftUnit) => DraftUnit) => {
    setDraft((current) => current && {
      ...current,
      units: current.units.map((unit) => unit.key === key ? update(unit) : unit),
    });
  };

  const canSave = draft?.units.every((unit) => unit.title.trim() && unit.lessons.every((lesson) => lesson.title.trim()));
  const save = async () => {
    if (!draft || !canSave || busy) return;
    setError(null);
    setBusy("saving");
    try {
      const result = await importCourseOutline(courseId, draft.ticket, { units: draft.units });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onSaved();
    } catch {
      setError(t("crs.outline.saveError"));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog open onClose={onClose} title={t("crs.outline.open")} wide>
      {draft ? (
        <>
          <p className="muted">{t("crs.outline.review")}</p>
          <fieldset disabled={!!busy} className="grid min-w-0 gap-4">
            {draft.units.map((unit) => (
              <section key={unit.key} className="rounded-xl border border-sep p-3">
                <details>
                  <summary className="cursor-pointer font-bold">{unit.title || t("crs.title")}</summary>
                  <OutlineFields entry={unit} titleLimit={120}
                    onChange={(fields) => updateUnit(unit.key, (current) => ({ ...current, ...fields }))} />
                </details>
                {unit.lessons.map((lesson) => (
                  <div key={lesson.key} className="mt-2 flex items-start gap-2 border-t border-sep pt-2">
                    <details className="min-w-0 flex-1">
                      <summary className="cursor-pointer py-1">{lesson.title || t("crs.lessonTitle")}</summary>
                      <OutlineFields entry={lesson} titleLimit={160}
                        onChange={(fields) => updateUnit(unit.key, (current) => ({
                          ...current,
                          lessons: current.lessons.map((item) => item.key === lesson.key ? { ...item, ...fields } : item),
                        }))} />
                    </details>
                    <button type="button" className="iconbtn"
                      aria-label={t("crs.outline.removeLesson", { title: lesson.title })}
                      title={t("crs.outline.removeLesson", { title: lesson.title })}
                      onClick={() => updateUnit(unit.key, (current) => ({
                        ...current,
                        lessons: current.lessons.filter((item) => item.key !== lesson.key),
                      }))}>
                      <Icon name="close" size="sm" />
                    </button>
                  </div>
                ))}
                {!unit.lessons.length && <p className="hint mb-0 mt-2">{t("crs.noLessons")}</p>}
              </section>
            ))}
          </fieldset>
        </>
      ) : (
        <div className="field">
          <label htmlFor="course-outline-files">{t("crs.outline.files")}</label>
          <p id="course-outline-help" className="hint m-0">{t("crs.outline.help", { n: OUTLINE_FILE_LIMIT })}</p>
          <input id="course-outline-files" className="input" type="file" accept={formats} multiple disabled={!!busy}
            aria-describedby="course-outline-help" onChange={(event) => {
              setFiles(Array.from(event.currentTarget.files ?? []));
              setError(null);
            }} />
        </div>
      )}

      {error && <p role="alert" className="alert mt-3">{error}</p>}
      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <button type="button" className="btn secondary" onClick={onClose}>{t("common.cancel")}</button>
        {draft ? (
          <button type="button" className="btn primary" disabled={!!busy || !canSave} onClick={save}>
            {busy === "saving" ? t("common.saving") : t("crs.outline.save")}
          </button>
        ) : (
          <button type="button" className="btn primary" disabled={!!busy || !files.length} onClick={analyze}>
            {busy === "reading" ? t("ai.reading") : busy === "planning" ? t("ai.splitting") : t("crs.outline.analyze")}
          </button>
        )}
      </div>
    </Dialog>
  );
}
