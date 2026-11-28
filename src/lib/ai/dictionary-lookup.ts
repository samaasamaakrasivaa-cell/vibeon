import "server-only";
import { withLock } from "../live/bus";
import { rateLimit } from "../rate-limit";
import { dictionaryQuery } from "./dictionary";
import { AiError, lookupDictionary, scrub, type Ctx } from "./gateway";

type LookupResult = { translations: string[] } | { error: "input" | "limit" | "unavailable" };

export async function searchDictionary(value: unknown, ctx: Ctx): Promise<LookupResult> {
  const { userId, teacherId, names } = ctx;
  if (!(await rateLimit(`dictionary:${userId}`, 20)) ||
      (teacherId && !(await rateLimit(`dictionary-teacher:${teacherId}`, 60)))) {
    return { error: "limit" };
  }

  const query = dictionaryQuery(value);
  if (!query || scrub(query, names) !== query) return { error: "input" };

  try {
    const translations = await withLock(`dictionary:${query}`, () => lookupDictionary(query, ctx));
    return { translations };
  } catch (error) {
    return { error: error instanceof AiError && error.code === "limit" ? "limit" : "unavailable" };
  }
}
