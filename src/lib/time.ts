// Время в часовом поясе пользователя. Сервер работает в UTC, поэтому все «дни», «недели» и «часы»
// считаются через пояс учителя/ученика (по умолчанию Europe/Moscow).

export type Parts = { y: number; m: number; d: number; h: number; min: number; dow: number }; // m: 1–12, dow: 0=Пн … 6=Вс

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function fmt(tz: string) {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-GB", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short", hourCycle: "h23" });
    fmtCache.set(tz, f);
  }
  return f;
}
const DOW: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };

export function partsIn(date: Date, tz: string): Parts {
  const o: Record<string, string> = {};
  for (const p of fmt(tz).formatToParts(date)) o[p.type] = p.value;
  return { y: +o.year, m: +o.month, d: +o.day, h: +o.hour % 24, min: +o.minute, dow: DOW[o.weekday] };
}

/** Смещение пояса относительно UTC в минутах для момента `date`. */
function offsetMin(date: Date, tz: string) {
  const p = partsIn(date, tz);
  return (Date.UTC(p.y, p.m - 1, p.d, p.h, p.min) - Math.floor(date.getTime() / 60000) * 60000) / 60000;
}

/** Момент времени по «настенным часам» в поясе tz. */
export function fromZoned(y: number, m: number, d: number, h: number, min: number, tz: string) {
  const guess = Date.UTC(y, m - 1, d, h, min);
  let t = guess - offsetMin(new Date(guess), tz) * 60000;
  t = guess - offsetMin(new Date(t), tz) * 60000; // уточнение на границе перехода времени
  return new Date(t);
}

/** "2026-11-03" — календарная дата в поясе. */
export function isoDay(date: Date, tz: string) {
  const p = partsIn(date, tz);
  return `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
}

export function parseIsoDay(s: string | undefined | null) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s ?? "");
  return m ? { y: +m[1], m: +m[2], d: +m[3] } : null;
}

/** Добавить дни к календарной дате (без учёта пояса). */
export function addDaysIso(s: string, n: number) {
  const p = parseIsoDay(s)!;
  const t = new Date(Date.UTC(p.y, p.m - 1, p.d + n));
  return t.toISOString().slice(0, 10);
}

/** Понедельник недели, в которой лежит дата `s` (ISO). */
export function mondayOf(s: string) {
  const p = parseIsoDay(s)!;
  const dow = (new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay() + 6) % 7;
  return addDaysIso(s, -dow);
}

export function dayStart(s: string, tz: string) {
  const p = parseIsoDay(s)!;
  return fromZoned(p.y, p.m, p.d, 0, 0, tz);
}

export const hhmm = (date: Date, tz: string) => {
  const p = partsIn(date, tz);
  return `${String(p.h).padStart(2, "0")}:${String(p.min).padStart(2, "0")}`;
};

export const minutesOfDay = (date: Date, tz: string) => {
  const p = partsIn(date, tz);
  return p.h * 60 + p.min;
};

export const TIMEZONES: [string, string][] = [
  ["Europe/Kaliningrad", "Калининград (UTC+2)"],
  ["Europe/Moscow", "Москва (UTC+3)"],
  ["Europe/Samara", "Самара (UTC+4)"],
  ["Asia/Yekaterinburg", "Екатеринбург (UTC+5)"],
  ["Asia/Omsk", "Омск (UTC+6)"],
  ["Asia/Novosibirsk", "Новосибирск (UTC+7)"],
  ["Asia/Krasnoyarsk", "Красноярск (UTC+7)"],
  ["Asia/Irkutsk", "Иркутск (UTC+8)"],
  ["Asia/Yakutsk", "Якутск (UTC+9)"],
  ["Asia/Vladivostok", "Владивосток (UTC+10)"],
  ["Asia/Magadan", "Магадан (UTC+11)"],
  ["Asia/Kamchatka", "Камчатка (UTC+12)"],
  ["Europe/Minsk", "Минск (UTC+3)"],
  ["Asia/Almaty", "Алматы (UTC+5)"],
  ["Asia/Tbilisi", "Тбилиси (UTC+4)"],
  ["Asia/Yerevan", "Ереван (UTC+4)"],
  ["Europe/Istanbul", "Стамбул (UTC+3)"],
  ["Asia/Dubai", "Дубай (UTC+4)"],
  ["Europe/Berlin", "Берлин (UTC+1/+2)"],
  ["Europe/London", "Лондон (UTC+0/+1)"],
];
