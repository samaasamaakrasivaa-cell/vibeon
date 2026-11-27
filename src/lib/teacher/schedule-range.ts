export function scheduleRangeMinutes(start: string, end: string): number | null {
  const clock = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
  if (!clock.test(start) || (end !== "24:00" && !clock.test(end))) return null;

  const minutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
  const duration = minutes(end) - minutes(start);
  return duration > 0 ? duration : null;
}
