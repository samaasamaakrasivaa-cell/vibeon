import type { CourseOutline } from "../tasks/course-outline";

const studentField = /(?:^|[^\p{L}\p{N}])(?:фио(?:\s+ученика)?|имя\s+учени(?:ка|цы)|ученик|ученица|student(?:\s+(?:full\s+name|name|id))?|learner(?:\s+(?:name|id))?)\s*[:=|\t]/iu;
const studentTable = /^(?:список\s+учеников|ведомость\s+оценок|журнал\s+успеваемости|student\s+(?:roster|grades|marks)|grade\s*book)(?=$|[^\p{L}])/iu;
const personalName = String.raw`\p{L}[\p{L}'’.-]*(?:[ ]+\p{L}[\p{L}'’.-]*){1,2}`;
const gradeValue = String.raw`\d{1,3}(?:[.,]\d+)?`;
const plainMark = String.raw`(?:0|[1-9]\d{0,2})(?:[.,]\d+)?[+-]?`;
const gradeScale = String.raw`(?:(?:/|из|out of)\s*\d{1,3}|%|балл(?:а|ов)?|pts?|points?)`;
const markedGrade = String.raw`${gradeValue}\s*${gradeScale}`;
const scoreLabel = /(?:^|[^\p{L}\p{N}])(?:оценка|балл(?:ы)?|результат|получил[а]?|grade|score|mark|result|received)\s*[:=]?\s*(?:[0-9]|[A-F](?:[+-]|\b))/iu;
const gradeCell = new RegExp(String.raw`^(?:${markedGrade}|${gradeValue}|[A-F][+-]?)$`, "iu");
const nameWithLevel = String.raw`${personalName}(?: +\([^()\n]{1,30}\))?`;
const nameOnly = new RegExp(String.raw`^${nameWithLevel}$`, "iu");
const bareGrade = new RegExp(String.raw`^${nameWithLevel} +(?:${plainMark}|${markedGrade})[.!]?$`, "iu");
const preciseName = String.raw`\p{Lu}[\p{L}'’.-]+(?: +\p{Lu}[\p{L}'’.-]+){1,2}`;
const inlineGrade = new RegExp(String.raw`(?:^|[^\p{L}\p{N}])${preciseName}(?: +\([^()\n]{1,30}\))? +${markedGrade}(?![\p{L}\p{N}])`, "u");
const cellSeparator = /\t+| {2,}|\s*[:,;|=–—]\s*|\s+-\s+/u;

const outlineTitle = /^(?:table of contents|contents|syllabus|scope and sequence|student[’']s book|оглавление|содержание|программа курса)[:.]?$/iu;
const unitHeading = /^(?<label>unit|module|chapter|юнит|модуль|раздел) +(?<number>\d{1,3})(?:\s*[.:–—-]\s*| +|$)(?<title>.*)$/iu;
const lessonHeading = /^(?<label>(?:lesson|урок) +\d{1,3}|\d{1,3}[a-z]|review|revision|progress check|повторение)(?:\s*[.:–—-]\s*| +|$)(?<title>.*)$/iu;
const curriculumField = /^(?<label>topics?|themes?|grammar|vocabulary|skills?|reading|listening|writing|speaking|pronunciation|темы?|грамматика|лексика|навыки|чтение|аудирование|письмо|говорение|произношение)\s*:\s*(?<value>.*)$/iu;

function unquote(text: string) {
  return text.trim().replace(/^["“”«»]+|["“”«»]+$/gu, "").trim();
}

function isStudentRecord(line: string) {
  if (studentField.test(line) || studentTable.test(line) || scoreLabel.test(line) || inlineGrade.test(line)) return true;
  const cells = line.replace(/^\d+[.)]\s*/, "").split(cellSeparator).map(unquote);
  let nameSeen = false;
  for (const cell of cells) {
    if (bareGrade.test(cell) || (nameSeen && gradeCell.test(cell))) return true;
    if (nameOnly.test(cell)) nameSeen = true;
  }
  return false;
}

function sourceLines(source: string) {
  return source.normalize("NFKC").replace(/\r\n?/gu, "\n").split("\n").map((line) => line.trim()).filter(Boolean);
}

function hasStudentRecords(lines: string[]) {
  return studentField.test(lines.join("\n")) || lines.some((line) => {
    const content = unitHeading.exec(line)?.groups?.title ?? lessonHeading.exec(line)?.groups?.title ??
      curriculumField.exec(line)?.groups?.value;
    return isStudentRecord(line) || (content !== undefined && isStudentRecord(content));
  });
}

export function hasCourseOutlineStudentRecords(source: string) {
  return hasStudentRecords(sourceLines(source));
}

export function outlinePlanHasStudentRecords(outline: CourseOutline) {
  return outline.units.some((unit) => [unit, ...unit.lessons].some(({ title, topics, grammar, vocabulary, skills }) =>
    hasCourseOutlineStudentRecords([title, topics, grammar, vocabulary, skills].join("\n")),
  ));
}

/** Admit only lines that can be assigned to the outline, and reject the entire mixed document. */
export function verifyCourseOutlineSource(source: string): { text: string } | { error: "studentRecords" | "unverified" | "noUnits" } {
  const lines = sourceLines(source);
  if (hasStudentRecords(lines)) return { error: "studentRecords" };

  const outline: string[] = [];
  let hasUnit = false;
  for (const line of lines) {
    if (outlineTitle.test(line)) continue;
    const unit = unitHeading.exec(line)?.groups;
    if (unit) {
      hasUnit = true;
      outline.push(unit.title ? `${unit.label} ${unit.number} — ${unit.title}` : `${unit.label} ${unit.number}`);
      continue;
    }
    const lesson = lessonHeading.exec(line)?.groups;
    const field = curriculumField.exec(line)?.groups;
    if (hasUnit && lesson) {
      outline.push(lesson.title ? `${lesson.label} — ${lesson.title}` : lesson.label);
    } else if (hasUnit && field) {
      if (field.value) outline.push(`${field.label}: ${field.value}`);
    } else {
      return { error: "unverified" };
    }
  }
  return hasUnit ? { text: outline.join("\n") } : { error: "noUnits" };
}
