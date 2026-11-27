const http = require("node:http");
const fs = require("node:fs");
const { PDFDocument } = require("pdf-lib");

let mode = "empty";
let calls = 0;
let active = 0;
let high = 0;
let release = () => undefined;
const send = (res, status, body) => res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));

const service = http.createServer(async (req, res) => {
  if (req.url === "/calls") return send(res, 200, { calls, active, high });
  if (req.url?.startsWith("/mode/")) {
    release();
    mode = req.url.slice(6);
    return send(res, 200, {});
  }
  if (req.url !== "/recognize" || req.method !== "POST") return res.writeHead(404).end();
  const requestMode = mode;
  calls++;
  active++;
  high = Math.max(high, active);
  try {
    let raw = "";
    for await (const part of req) raw += part;
    const payload = JSON.parse(raw);
    const data = Buffer.from(payload.content, "base64");
    if (Buffer.byteLength(raw) > 4 * Math.ceil(7 * 1024 ** 2 / 3) + 512 ||
        data.length > 7 * 1024 ** 2 || !["PNG", "PDF", "JPEG"].includes(payload.mimeType) ||
        (payload.mimeType === "PNG" && (data.toString("ascii", 1, 4) !== "PNG" || data.includes("eXIf"))) ||
        (payload.mimeType === "PDF" && !data.subarray(0, 5).equals(Buffer.from("%PDF-"))) ||
        (payload.mimeType === "JPEG" && (data[0] !== 255 || data[1] !== 216 || data.includes("Exif")))) return send(res, 400, {});
    if (payload.mimeType === "PDF") {
      const pdf = await PDFDocument.load(data, { updateMetadata: false });
      if (pdf.getPageCount() !== 1 || pdf.context.trailerInfo.Info) return send(res, 400, {});
    }
    if (requestMode === "hold") await new Promise((resolve) => { release = resolve; });
    if (requestMode === "timeout") await new Promise((resolve) => res.on("close", resolve));
    if (requestMode === "throttle") return send(res, 429, {});
    if (requestMode === "fail") return send(res, 503, {});
    if (requestMode === "broken") return res.writeHead(200).end("not json");
    if (requestMode === "schema") return send(res, 200, { result: {} });
    return send(res, 200, { result: { textAnnotation: { fullText: requestMode === "match" ? "900 руб" : "" } } });
  } catch {
    if (!res.writableEnded) send(res, 400, {});
  } finally {
    active--;
  }
});
service.listen(0, "127.0.0.1", () => fs.writeFileSync(process.argv[2], String(service.address().port)));
