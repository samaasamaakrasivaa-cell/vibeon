// Ближайший день рождения ученика (дата из анкеты): через сколько дней, какого числа и сколько исполнится.
import { addDaysIso } from "./time";

const pad = (n: number) => String(n).padStart(2, "0");

/** today — сегодняшняя дата учителя (YYYY-MM-DD). 29 февраля в невисокосный год — 28 февраля. */
export function nextBirthday(birthday: Date, today: string) {
  const by = birthday.getUTCFullYear(), bm = birthday.getUTCMonth() + 1, bd = birthday.getUTCDate();
  const ty = +today.slice(0, 4);
  const iso = (y: number) => {
    const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
    return `${y}-${pad(bm)}-${pad(bm === 2 && bd === 29 && !leap ? 28 : bd)}`;
  };
  let y = ty, next = iso(y);
  if (next < today) { y = ty + 1; next = iso(y); }
  let days = 0;
  for (let d = today; d < next && days < 400; d = addDaysIso(d, 1)) days++;
  return { days, iso: next, age: by > 1900 ? y - by : null };
}
