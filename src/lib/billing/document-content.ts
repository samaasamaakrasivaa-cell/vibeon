import "server-only";
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream } from "pdf-lib";
import sharp from "sharp";
import { MAX_UPLOAD } from "../storage";

const imageTypes = { jpeg: "image/jpeg", png: "image/png", webp: "image/webp" } as const;
const pdfMime = "application/pdf";
const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const jpegSignature = Buffer.from([255, 216, 255]);

function rasterFormat(buf: Buffer) {
  if (buf.subarray(0, 8).equals(pngSignature)) return "png";
  if (buf.subarray(0, 3).equals(jpegSignature)) return "jpeg";
  if (buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") return "webp";
  return null;
}

export function paymentDocumentExtension(mime: string) {
  if (mime === pdfMime) return "pdf";
  if (mime === imageTypes.jpeg) return "jpg";
  if (mime === imageTypes.png) return "png";
  if (mime === imageTypes.webp) return "webp";
  return null;
}

const activePdfKeys = [
  "A", "AA", "OpenAction", "JavaScript", "JS", "AcroForm", "XFA",
  "EmbeddedFiles", "EF", "AF", "Collection", "RichMediaContent", "RichMediaSettings",
].map(PDFName.of);
const activePdfTypes = new Set([
  "/Action", "/EmbeddedFile", "/Filespec", "/FileAttachment", "/RichMedia", "/Screen",
  "/Movie", "/Sound", "/3D", "/Widget",
]);

async function passivePdf(buf: Buffer) {
  if (!/^%PDF-[12]\.\d/.test(buf.toString("ascii", 0, 9)) ||
      !/%%EOF[\r\n\t ]*$/.test(buf.subarray(-1024).toString("latin1"))) return false;
  const pdf = await PDFDocument.load(buf, { updateMetadata: false, throwOnInvalidObject: true });
  if (!pdf.getPageCount()) return false;

  // Inspect decoded objects as well as directly nested dictionaries. Keys in
  // compressed object streams have the same checks as plain PDF objects.
  const objects = pdf.context.enumerateIndirectObjects().map(([, object]) => object);
  for (let i = 0; i < objects.length; i++) {
    const object = objects[i];
    if (object instanceof PDFRawStream) {
      if (object.dict.has(PDFName.of("F"))) return false; // external stream
      objects.push(object.dict);
    } else if (object instanceof PDFDict) {
      if (activePdfKeys.some((key) => object.has(key)) ||
          ["Type", "Subtype"].some((key) => activePdfTypes.has(String(object.lookup(PDFName.of(key)))))) return false;
      for (const [, value] of object.entries()) objects.push(value);
    } else if (object instanceof PDFArray) {
      for (const value of object.asArray()) objects.push(value);
    }
  }
  return true;
}

export async function inspectPaymentDocument(buf: Buffer, declaredMime: string) {
  if (!buf.length || buf.length > MAX_UPLOAD) return null;
  try {
    if (declaredMime === pdfMime) return await passivePdf(buf) ? { buf, mime: pdfMime } : null;

    const format = rasterFormat(buf);
    if (!format) return null;
    const mime = imageTypes[format];
    if (declaredMime && declaredMime !== mime) return null;
    const image = sharp(buf, { limitInputPixels: 24_000_000, failOn: "warning" });
    const meta = await image.metadata();
    if (meta.format !== format || (meta.pages ?? 1) !== 1) return null;
    // Decode and re-encode to drop metadata, appended bytes and other payloads.
    const clean = await image.rotate().toFormat(format).toBuffer();
    return clean.length <= MAX_UPLOAD ? { buf: clean, mime } : null;
  } catch {
    return null;
  }
}
