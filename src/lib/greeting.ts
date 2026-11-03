import type { DictKey } from "./i18n/dict";

export function greetingKey(hour: number): DictKey {
  if (hour < 5) return "greet.night";
  if (hour < 12) return "greet.morning";
  if (hour < 18) return "greet.day";
  return "greet.evening";
}

export function hourIn(timezone: string, d = new Date()) {
  return Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone: timezone }).format(d));
}
