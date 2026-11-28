import "server-only";
import { execFile } from "node:child_process";
import { extractText } from "unpdf";
import { hasCourseOutlineStudentRecords } from "./course-outline-privacy";
import sharp from "sharp";

const maxImagePixels = 16_000_000;
const minWordConfidence = 55;
const maxScannedPages = 6;
let recognizing = false;

export const OUTLINE_IMAGE_MAX = 8 * 1024 * 1024;

type ReadResult = { text: string; ocr: boolean } | {
  error: "outlineImage" | "outlineBusy" | "outlineText" | "outlinePdfPages" | "studentRecords";
};

function runLocal(command: string, args: string[], input: Buffer, timeout: number, maxBuffer: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = execFile(command, args, {
      encoding: "buffer",
      timeout,
      killSignal: "SIGKILL",
      maxBuffer,
      env: { ...process.env, LC_ALL: "C", OMP_THREAD_LIMIT: "1" },
    }, (error, stdout, stderr) => {
      if (error || /failed loading language|error opening data file|syntax error/i.test(stderr.toString())) {
        reject(new Error("Local outline extraction failed"));
      } else {
        resolve(stdout);
      }
    });
    child.stdin?.on("error", reject);
    child.stdin?.end(input);
  });
}

function confidentText(tsv: string) {
  const lines = new Map<string, string[]>();
  for (const row of tsv.split("\n").slice(1)) {
    const [level, page, block, paragraph, line, , , , , , confidence, word] = row.split("\t");
    if (level !== "5" || !word?.trim()) continue;
    if (!Number.isFinite(Number(confidence)) || Number(confidence) < minWordConfidence) return "";
    const key = `${page}:${block}:${paragraph}:${line}`;
    const words = lines.get(key);
    if (words) words.push(word.trim());
    else lines.set(key, [word.trim()]);
  }
  return [...lines.values()].map((words) => words.join(" ")).join("\n");
}

async function readImage(buffer: Buffer) {
  const image = sharp(buffer, { limitInputPixels: maxImagePixels, failOn: "warning" });
  const { format, pages } = await image.metadata();
  if (!(format === "jpeg" || format === "png" || format === "webp") || (pages ?? 1) > 1) return "";
  const png = await image.rotate().flatten({ background: "white" }).greyscale().png().toBuffer();
  const args = ["stdin", "stdout", "-l", "eng+rus", "--psm", "6", "--dpi", "300", "-c", "tessedit_create_tsv=1"];
  return confidentText((await runLocal("tesseract", args, png, 12_000, 1024 * 1024)).toString());
}

async function withLocalReader(read: () => Promise<ReadResult>, fallback: "outlineImage" | "outlineText"): Promise<ReadResult> {
  if (recognizing) return { error: "outlineBusy" };
  recognizing = true;
  try {
    return await read();
  } catch {
    return { error: fallback };
  } finally {
    recognizing = false;
  }
}

export function readCourseOutlineImage(buffer: Buffer): Promise<ReadResult> {
  return withLocalReader(async () => {
    const text = await readImage(buffer);
    return text ? { text, ocr: true } : { error: "outlineImage" };
  }, "outlineImage");
}

export function readCourseOutlinePdf(buffer: Buffer): Promise<ReadResult> {
  return withLocalReader(async () => {
    const { text: layers } = await extractText(new Uint8Array(buffer), { mergePages: false });
    if (hasCourseOutlineStudentRecords(layers.join("\n\n"))) return { error: "studentRecords" };

    // Check raster content even when a page also has a text layer.
    const inventory = await runLocal("pdfimages", ["-list", "-"], buffer, 5_000, 512 * 1024);
    const imagePages = new Set([...inventory.toString().matchAll(/^\s*(\d+) +\d+ +\S+/gm)].map((row) => Number(row[1])));
    const scanCount = layers.filter((layer, index) => imagePages.has(index + 1) || !layer.trim()).length;
    if (scanCount > maxScannedPages) return { error: "outlinePdfPages" };

    const pages: string[] = [];
    for (const [index, layer] of layers.entries()) {
      const page = index + 1;
      if (!imagePages.has(page) && layer.trim()) {
        pages.push(layer);
        continue;
      }
      const args = ["-f", String(page), "-l", String(page), "-scale-to", "2400", "-gray", "-singlefile", "-png", "-"];
      const bitmap = await runLocal("pdftoppm", args, buffer, 8_000, 8 * 1024 * 1024);
      const text = await readImage(bitmap);
      if (!text) return { error: "outlineText" };
      pages.push(text);
    }
    return { text: pages.join("\n\n"), ocr: scanCount > 0 };
  }, "outlineText");
}
