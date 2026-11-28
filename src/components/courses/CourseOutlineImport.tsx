"use client";

import { useEffect, useState } from "react";
import { planCourseOutline } from "@/lib/ai/actions";
import { useT } from "@/lib/i18n/client";
import { isCourseOutlineImage, OUTLINE_FILE_LIMIT, OUTLINE_SOURCE_LIMIT, type CourseOutlineEntry } from "@/lib/tasks/course-outline";
import { importCourseOutline } from "@/lib/teacher/courses";
import { extractFileResult } from "../ai/BookImport";
import { randomId } from "../builder/rid";
import { Dialog } from "../Dialog";
import { Icon } from "../Icon";

const formats = ".jpg,.jpeg,.png,.webp,.pdf,.docx";
const outlineErrors = ["outlineText", "outlineImage", "outlineImageSize", "outlineBusy", "outlinePdfPages", "studentRecords"] as const;
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

function OriginalOutline({ file }: { file: File }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    const preview = URL.createObjectURL(file);
    setUrl(preview);
    return () => URL.revokeObjectURL(preview);
  }, [file]);

  if (!isCourseOutlineImage(file.name)) return url && <a href={url} target="_blank" rel="noopener">{file.name}</a>;
  return (
    <details>
      <summary className="cursor-pointer">{file.name}</summary>
      {url && <img src={url} alt={file.name} className="max-h-[36rem] max-w-full object-contain" />}
    </details>
  );
}

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
  const [reviewText, setReviewText] = useState<string | null>(null);
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
    try {
      let source = reviewText;
      if (source === null) {
        setBusy("reading");
        const pages: string[] = [];
        let needsReview = false;
        for (const file of files) {
          try {
            const extraction = await extractFileResult(file, "course-outline");
            const page = extraction.text.trim();
            needsReview ||= extraction.ocr;
            if (!page) {
              setError(`${file.name} · ${t("ai.err.empty")}`);
              return;
            }
            pages.push(page);
          } catch (problem) {
            const message = problem instanceof Error ? problem.message : "";
            const local = outlineErrors.find((code) => code === message);
            const code = extractionErrors.find((code) => code === message);
            setError(`${file.name} · ${local ? t(`crs.outline.${local}`) : code ? t(`ai.err.${code}`) : t("ai.err.fail")}`);
            return;
          }
        }
        source = pages.join("\n\n");
        if (source.length <= OUTLINE_SOURCE_LIMIT && needsReview) {
          setReviewText(source);
          return;
        }
      }
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
              setReviewText(null);
              setError(null);
            }} />
          {reviewText !== null && (
            <>
              {files.filter((file) => isCourseOutlineImage(file.name) || /\.pdf$/i.test(file.name)).map((file, index) => (
                <OriginalOutline key={`${index}:${file.name}`} file={file} />
              ))}
              <label htmlFor="course-outline-recognized">{t("crs.outline.recognized")}</label>
              <p id="course-outline-recognized-help" className="hint m-0">{t("crs.outline.recognizedHelp")}</p>
              <textarea id="course-outline-recognized" className="textarea" rows={12} maxLength={OUTLINE_SOURCE_LIMIT}
                value={reviewText} disabled={!!busy} aria-describedby="course-outline-recognized-help"
                onChange={(event) => { setReviewText(event.currentTarget.value); setError(null); }} />
            </>
          )}
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
          <button type="button" className="btn primary" disabled={!!busy || !files.length || reviewText === ""} onClick={analyze}>
            {busy === "reading" ? t("ai.reading") : busy === "planning" ? t("ai.splitting") : t(reviewText === null ? "crs.outline.analyze" : "crs.outline.checkText")}
          </button>
        )}
      </div>
    </Dialog>
  );
}
