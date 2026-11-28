const studentField = /(?:^|[^\p{L}\p{N}])(?:фио(?:\s+ученика)?|имя\s+учени(?:ка|цы)|ученик|ученица|student(?:\s+(?:full\s+name|name|id))?|learner(?:\s+(?:name|id))?)\s*[:=|\t]/iu;
const studentTable = /(?:^|\n)\s*(?:список\s+учеников|ведомость\s+оценок|журнал\s+успеваемости|student\s+(?:roster|grades|marks)|grade\s*book)(?=$|[^\p{L}])/iu;
const personalName = String.raw`\p{Lu}[\p{L}'’.-]*(?:[ \t]+\p{Lu}[\p{L}'’.-]*){1,2}`;
const scoreField = /^(?:оценка|балл(?:ы)?|результат|grade|score|mark|result)\s*[:=]?\s*(?:[0-9]|[A-F](?:[+-]|\b))/iu;
const standaloneScore = /^(?:\d{1,3}(?:[.,]\d+)?(?:\s*(?:%|\/\s*\d+))?|[A-F][+-]?)\s*(?=$|[|;,()])/u;
const namedRecord = new RegExp(String.raw`^\s*(?:\d+[.)]\s*)?(${personalName})(?:\s*[:,;|=–—-]\s*|\t+| {2,})(.+)$`, "u");
const namedAssessment = new RegExp(String.raw`^\s*${personalName}\s+(?:оценка|балл(?:ы)?|получил[а]?|grade|score|mark|received)\s*[:=]?\s*(?:[0-9]|[A-F](?:[+-]|\b))`, "iu");
const cyrillicNameAndGrade = /^\s*[А-ЯЁ][а-яё-]+(?: [А-ЯЁ][а-яё-]+){1,2} [1-5][+-]?$/u;
const nameOnly = new RegExp(String.raw`^${personalName}$`, "u");

/** Reject record-like text rather than forwarding a partially masked student record. */
export function containsStudentRecords(source: string) {
  const normalized = source.normalize("NFKC").replace(/\r\n?/g, "\n");
  if (studentField.test(normalized) || studentTable.test(normalized)) return true;
  const lines = normalized.split("\n").map((line) => line.trim()).filter(Boolean);

  return lines.some((line, index) => {
    const record = namedRecord.exec(line);
    if (record && (scoreField.test(record[2]) || standaloneScore.test(record[2]))) return true;
    return cyrillicNameAndGrade.test(line) || namedAssessment.test(line) || (nameOnly.test(line) &&
      (scoreField.test(lines[index + 1] ?? "") || scoreField.test(lines[index - 1] ?? "")));
  });
}
