import { createHash, randomBytes } from "node:crypto";

export const randomToken = (bytes = 32) => randomBytes(bytes).toString("base64url");
export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/** Короткий код для ссылок, которые человек пересылает сам: 10 символов без похожих (0/o, 1/l/i) — ≈ 8·10¹⁴ вариантов. */
const ALPHA = "23456789abcdefghjkmnpqrstuvwxyz";
export const shortCode = (len = 10) => Array.from(randomBytes(len), (b) => ALPHA[b % ALPHA.length]).join("");
