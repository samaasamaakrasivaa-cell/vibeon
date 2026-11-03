import "server-only";
import { headers } from "next/headers";

const hits = new Map<string, number[]>();

/** Простое ограничение частоты по IP: не больше `limit` попыток за `windowSec` секунд. */
export async function rateLimit(bucket: string, limit = 10, windowSec = 60) {
  const h = await headers();
  const ip = h.get("x-real-ip") || h.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  const key = `${bucket}:${ip}`;
  const now = Date.now();
  const arr = (hits.get(key) ?? []).filter((t) => now - t < windowSec * 1000);
  arr.push(now);
  hits.set(key, arr);
  if (hits.size > 10000) hits.clear();
  return arr.length <= limit;
}
