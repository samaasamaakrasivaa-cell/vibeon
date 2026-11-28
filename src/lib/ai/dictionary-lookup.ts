import "server-only";
import { withLock } from "../live/bus";
import { rateLimit } from "../rate-limit";
import { dictionaryQuery } from "./dictionary";
import { AiError, lookupDictionary, scrub, type Ctx } from "./gateway";

type LookupResult = { translations: string[] } | { error: "input" | "limit" | "unavailable" };

// The classroom route and student server action load separate bundles in the same process.
const globalForDictionary = globalThis as typeof globalThis & { dictionaryRateCounters?: Map<string, number[]> };
const counters = (globalForDictionary.dictionaryRateCounters ??= new Map());

export async function allowDictionaryRequest({ userId, teacherId }: Ctx) {
  return await rateLimit(`dictionary:${userId}`, 20, 60, counters) &&
    (!teacherId || await rateLimit(`dictionary-teacher:${teacherId}`, 60, 60, counters));
}

export async function searchDictionary(readQuery: () => unknown, ctx: Ctx): Promise<LookupResult> {
  if (!(await allowDictionaryRequest(ctx))) return { error: "limit" };

  const query = dictionaryQuery(await readQuery());
  if (!query || scrub(query, names) !== query) return { error: "input" };

  try {
    const translations = await withLock(`dictionary:${query}`, () => lookupDictionary(query, ctx));
    return { translations };
  } catch (error) {
    return { error: error instanceof AiError && error.code === "limit" ? "limit" : "unavailable" };
  }
}
