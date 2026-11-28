import assert from "node:assert/strict";
import sharp from "sharp";
import { readCourseOutlineImage } from "../src/lib/ai/course-outline-ocr";
import { verifyCourseOutlineSource } from "../src/lib/ai/course-outline-privacy";

const syllabus = ["Unit 1: Travel", "Lesson 1: Railway stations", "Topics: Directions and timetables"];
const studentRecord = "Нина Учебная (B1) - 87/100";

function image(lines: string[]) {
  const text = lines.map((line, index) => `<text x="50" y="${70 + index * 68}">${line}</text>`).join("");
  return sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1400" height="${100 + lines.length * 68}">
    <rect width="100%" height="100%" fill="white"/>
    <g font-family="DejaVu Sans" font-size="44" fill="black">${text}</g>
  </svg>`));
}

async function main() {
  const expected = { text: "Unit 1 — Travel\nLesson 1 — Railway stations\nTopics: Directions and timetables" };
  for (const format of ["png", "jpeg", "webp"] as const) {
    const result = await readCourseOutlineImage(await image(syllabus).toFormat(format).toBuffer());
    assert.ok("text" in result, `Could not recognise a clean ${format} syllabus`);
    assert.deepEqual(verifyCourseOutlineSource(result.text), expected);
  }

  const mixed = await readCourseOutlineImage(await image([...syllabus, studentRecord]).png().toBuffer());
  assert.ok("text" in mixed && mixed.text.includes("Учебная") && mixed.text.includes("87/100"));
  assert.deepEqual(verifyCourseOutlineSource(mixed.text), { error: "studentRecords" });

  const invalid = { error: "outlineImage" };
  assert.deepEqual(await readCourseOutlineImage(await image([]).png().toBuffer()), invalid);
  assert.deepEqual(await readCourseOutlineImage(Buffer.from("Unreadable image")), invalid);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
