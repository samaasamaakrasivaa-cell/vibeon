const sharp = require("sharp");
const { inflateSync } = require("node:zlib");
const { PDFDocument, PDFName, PDFDict, PDFArray, PDFNumber, PDFRawStream } = require("pdf-lib");
const decode = require("pdf-lib/cjs/core/streams/decode");
const Stream = require("pdf-lib/cjs/core/streams/Stream").default;
const limits = require("./limits.cjs");

const pdfMime = "application/pdf";
const images = { jpeg: "image/jpeg", png: "image/png", webp: "image/webp" };
const name = PDFName.of;
const activeKeys = [
  "A", "AA", "OpenAction", "JavaScript", "JS", "AcroForm", "XFA", "EmbeddedFiles",
  "EF", "AF", "Collection", "RichMediaContent", "RichMediaSettings",
].map(name);
const activeTypes = new Set(["/Action", "/EmbeddedFile", "/Filespec", "/FileAttachment",
  "/RichMedia", "/Screen", "/Movie", "/Sound", "/3D", "/Widget"]);

class InvalidDocument extends Error {}
const deny = (code) => { throw new InvalidDocument(code); };

function formatOf(buf) {
  if (buf.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "png";
  if (buf.subarray(0, 3).equals(Buffer.from([255, 216, 255]))) return "jpeg";
  if (buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") return "webp";
  return null;
}

async function raster(buf, expected) {
  if (formatOf(buf) !== expected) deny("type");
  const image = sharp(buf, { limitInputPixels: false, failOn: "warning" });
  const m = await image.metadata();
  if (m.format !== expected || !m.width || !m.height || (m.pages ?? 1) !== 1) deny("type");
  if (m.width * m.height > limits.PIXELS) deny("pixels");
  return { image: sharp(buf, { limitInputPixels: limits.PIXELS, failOn: "warning" }), width: m.width, height: m.height };
}

function pageCount(pdf) {
  const work = [pdf.catalog.lookup(name("Pages"), PDFDict)];
  const seen = new Set();
  let total = 0;
  while (work.length) {
    const next = work.pop();
    if (!(next instanceof PDFDict) || seen.has(next)) deny("type");
    seen.add(next);
    const type = next.lookup(name("Type"));
    if (type === name("Page")) {
      if (++total > limits.PDF_PAGES) deny("pages");
    } else if (type === name("Pages")) {
      const children = next.lookup(name("Kids"), PDFArray);
      for (let i = children.size() - 1; i >= 0; i--) work.push(children.lookup(i));
    } else deny("type");
  }
  if (!total) deny("type");
  return total;
}

function imageDimensions(dict) {
  const width = dict.lookup(name("Width"), PDFNumber).asNumber();
  const height = dict.lookup(name("Height"), PDFNumber).asNumber();
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) deny("type");
  if (width > Math.floor(limits.PIXELS / height)) deny("pixels");
  return { width, height };
}

async function inspectPdf(buf) {
  if (!/^%PDF-[12]\.\d/.test(buf.toString("ascii", 0, 9)) ||
      !/%%EOF[\r\n\t ]*$/.test(buf.subarray(-1024).toString("latin1"))) deny("type");

  const stored = new WeakMap();
  let remaining = limits.INFLATED;
  const charge = (bytes) => {
    if (bytes > remaining) deny("expanded");
    remaining -= bytes;
  };
  const filterOf = (stream) => {
    const filter = stream.dict.lookup(name("Filter"));
    if (filter instanceof PDFArray && filter.size() === 1) return filter.lookup(0);
    return filter;
  };
  const boundedDecode = (stream) => {
    const cached = stored.get(stream);
    if (cached) return new Stream(cached);
    const filter = filterOf(stream);
    const raw = stream.getContents();
    let bytes = raw;
    if (filter === name("FlateDecode")) {
      if (remaining < 1) deny("expanded");
      try {
        bytes = inflateSync(raw, { maxOutputLength: remaining });
      } catch (error) {
        deny(error.code === "ERR_BUFFER_TOO_LARGE" ? "expanded" : "type");
      }
    } else if (filter) deny("type");
    charge(bytes.length);
    stored.set(stream, bytes);
    return new Stream(bytes);
  };

  // pdf-lib's CJS parser calls this export when opening xref and object streams.
  // The worker handles exactly one document. Make those implicit inflations
  // share the same budget as the explicit stream audit below.
  const original = decode.decodePDFRawStream;
  let structuralError;
  decode.decodePDFRawStream = (stream) => {
    try {
      return boundedDecode(stream);
    } catch (error) {
      structuralError = error;
      throw error;
    }
  };
  let pdf;
  try {
    pdf = await PDFDocument.load(buf, { updateMetadata: false, throwOnInvalidObject: true });
    if (structuralError) throw structuralError;
  } catch (error) {
    throw structuralError ?? error;
  } finally {
    decode.decodePDFRawStream = original;
  }
  const pages = pageCount(pdf);

  const objects = pdf.context.enumerateIndirectObjects().map(([, object]) => object);
  const visited = new Set();
  for (const object of objects) {
    if (visited.has(object)) continue;
    visited.add(object);
    if (object instanceof PDFRawStream) {
      if (object.dict.has(name("F")) || object.dict.has(name("DecodeParms"))) deny("type");
      const isImage = object.dict.lookup(name("Subtype")) === name("Image");
      const dimensions = isImage ? imageDimensions(object.dict) : null;
      if (dimensions) charge(dimensions.width * dimensions.height * 4);
      const filter = filterOf(object);
      if (filter === name("DCTDecode")) {
        if (!dimensions) deny("type");
        const { image, width, height } = await raster(Buffer.from(object.getContents()), "jpeg");
        if (width !== dimensions.width || height !== dimensions.height) deny("type");
        await image.raw().toBuffer();
      } else {
        const bytes = boundedDecode(object).getBytes();
        // Inline images can carry an independent filter chain inside a content stream.
        // Reject their operator until that nested representation is budgeted.
        if (bytes.includes(66) && /(?:^|[\x00\t\n\f\r ()<>\[\]{}/%])BI(?=$|[\x00\t\n\f\r ()<>\[\]{}/%])/.test(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("latin1"))) deny("type");
      }
      objects.push(object.dict);
    } else if (object instanceof PDFDict) {
      if (activeKeys.some((key) => object.has(key)) ||
          ["Type", "Subtype"].some((key) => activeTypes.has(String(object.lookup(name(key)))))) deny("type");
      for (const [, value] of object.entries()) objects.push(value);
    } else if (object instanceof PDFArray) {
      for (const value of object.asArray()) objects.push(value);
    }
  }

  let ocr;
  if (pages === 1) {
    const clean = await PDFDocument.create({ updateMetadata: false });
    const [page] = await clean.copyPages(pdf, [0]);
    clean.addPage(page);
    for (const [, object] of clean.context.enumerateIndirectObjects()) {
      const dict = object instanceof PDFRawStream ? object.dict : object;
      if (dict instanceof PDFDict) {
        for (const key of ["Metadata", "PieceInfo", "LastModified", "StructParents"]) dict.delete(name(key));
      }
    }
    clean.context.trailerInfo.Info = undefined;
    const cleanBytes = Buffer.from(await clean.save({ updateFieldAppearances: false }));
    if (cleanBytes.length <= limits.OCR_FILE) ocr = { buf: cleanBytes, mime: pdfMime };
  }
  return { buf, mime: pdfMime, pages, ocr };
}

async function inspect(buf, declaredType) {
  try {
    if (!buf.length || buf.length > limits.FILE) deny("size");
    if (declaredType === "application/octet-stream") declaredType = "";
    if (declaredType === pdfMime || !declaredType && buf.toString("ascii", 0, 5) === "%PDF-") return await inspectPdf(buf);
    const format = formatOf(buf);
    if (!format || declaredType && declaredType !== images[format]) deny("type");
    const { image } = await raster(buf, format);
    const clean = await image.clone().rotate().toFormat(format).toBuffer();
    if (clean.length > limits.FILE) deny("size");
    const ocrBytes = format === "webp" ? await image.clone().rotate().jpeg().toBuffer() : clean;
    const ocr = ocrBytes.length <= limits.OCR_FILE ? { buf: ocrBytes, mime: format === "webp" ? images.jpeg : images[format] } : undefined;
    return { buf: clean, mime: images[format], pages: 1, ocr };
  } catch (error) {
    return { error: error instanceof InvalidDocument ? error.message : "type" };
  }
}

async function main() {
  const parts = [];
  let size = 0;
  for await (const part of process.stdin) {
    size += part.length;
    if (size > limits.FILE) {
      process.stdout.write('{"error":"size"}\n');
      return;
    }
    parts.push(part);
  }
  const result = await inspect(Buffer.concat(parts, size), process.argv[2]);
  if (result.error) {
    process.stdout.write(JSON.stringify(result) + "\n");
    return;
  }
  process.stdout.write(JSON.stringify({
    mime: result.mime, size: result.buf.length, pages: result.pages,
    ocrMime: result.ocr?.mime, ocrSize: result.ocr?.buf.length ?? 0,
  }) + "\n");
  process.stdout.write(result.buf);
  if (result.ocr) process.stdout.write(result.ocr.buf);
}

if (require.main === module) void main().catch(() => { process.exitCode = 1; });
