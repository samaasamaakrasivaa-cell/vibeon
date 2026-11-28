import "server-only";
import { execFile } from "node:child_process";
import sharp from "sharp";

const maxImagePixels = 16_000_000;
const minWordConfidence = 55;
let recognizing = false;

export const OUTLINE_IMAGE_MAX = 8 * 1024 * 1024;

function recognize(image: Buffer): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile("tesseract", ["stdin", "stdout", "-l", "eng+rus", "--psm", "6", "--dpi", "300", "-c", "tessedit_create_tsv=1"], {
      timeout: 12_000,
      killSignal: "SIGKILL",
      maxBuffer: 1024 * 1024,
      env: { ...process.env, OMP_THREAD_LIMIT: "1" },
    }, (error, stdout, stderr) => {
      if (error || /failed loading language|error opening data file/i.test(stderr)) {
        reject(new Error("Local outline recognition failed"));
      } else {
        resolve(stdout);
      }
    });
    child.stdin?.on("error", reject);
    child.stdin?.end(image);
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

export async function readCourseOutlineImage(buffer: Buffer): Promise<{ text: string } | { error: "outlineImage" | "outlineBusy" }> {
  if (recognizing) return { error: "outlineBusy" };
  recognizing = true;
  try {
    const image = sharp(buffer, { limitInputPixels: maxImagePixels, failOn: "warning" });
    const { format, pages } = await image.metadata();
    if (!(format === "jpeg" || format === "png" || format === "webp") || (pages ?? 1) > 1) {
      return { error: "outlineImage" };
    }
    const png = await image.rotate().flatten({ background: "white" }).greyscale().png().toBuffer();
    const text = confidentText(await recognize(png));
    return text ? { text } : { error: "outlineImage" };
  } catch {
    return { error: "outlineImage" };
  } finally {
    recognizing = false;
  }
}
