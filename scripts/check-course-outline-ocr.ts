import assert from "node:assert/strict";
import sharp from "sharp";
import { readCourseOutlineImage, readCourseOutlinePdf } from "../src/lib/ai/course-outline-ocr";
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

async function imagePdf(lines: string[], hiddenText = "") {
  const { data, info } = await image(lines).jpeg().toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  const contents = `q ${width} 0 0 ${height} 0 0 cm /I Do Q
BT /F 24 Tf 3 Tr 50 50 Td (${hiddenText}) Tj ET`;
  const objects = [
    Buffer.from("<< /Type /Catalog /Pages 2 0 R >>"),
    Buffer.from("<< /Type /Pages /Kids [3 0 R] /Count 1 >>"),
    Buffer.from(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}]
      /Resources << /XObject << /I 4 0 R >> /Font << /F 6 0 R >> >> /Contents 5 0 R >>`),
    Buffer.concat([Buffer.from(`<< /Type /XObject /Subtype /Image /ColorSpace /DeviceRGB /BitsPerComponent 8
      /Width ${width} /Height ${height} /Filter /DCTDecode /Length ${data.length} >>
stream
`), data, Buffer.from("\nendstream")]),
    Buffer.from(`<< /Length ${Buffer.byteLength(contents)} >>
stream
${contents}
endstream`),
    Buffer.from("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"),
  ];
  let file = Buffer.from("%PDF-1.4\n");
  const offsets = objects.map((object, index) => {
    const offset = file.length;
    file = Buffer.concat([file, Buffer.from(`${index + 1} 0 obj\n`), object, Buffer.from("\nendobj\n")]);
    return String(offset).padStart(10, "0") + " 00000 n \n";
  });
  return Buffer.concat([file, Buffer.from(
    `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.join("")}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${file.length}\n%%EOF\n`,
  )]);
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

  const scanned = await readCourseOutlinePdf(await imagePdf(syllabus));
  assert.ok("ocr" in scanned && scanned.ocr, JSON.stringify(scanned));
  assert.deepEqual(verifyCourseOutlineSource(scanned.text), expected);

  const hybrid = await readCourseOutlinePdf(await imagePdf([...syllabus, studentRecord], "Contents"));
  assert.ok("ocr" in hybrid && hybrid.ocr && hybrid.text.includes("87/100"));
  assert.deepEqual(verifyCourseOutlineSource(hybrid.text), { error: "studentRecords" });

  const hiddenRecord = await readCourseOutlinePdf(await imagePdf(syllabus, "Test Student - 88/100"));
  assert.deepEqual(hiddenRecord, { error: "studentRecords" });

  const invalid = { error: "outlineImage" };
  assert.deepEqual(await readCourseOutlineImage(await image([]).png().toBuffer()), invalid);
  assert.deepEqual(await readCourseOutlineImage(Buffer.from("Unreadable image")), invalid);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
