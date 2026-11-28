import "server-only";

// Шина событий класса в памяти процесса. Один контейнер приложения — одна шина.
// Для нескольких экземпляров приложения шину переводят на Redis pub/sub (REDIS_URL) без изменения интерфейса.
type Listener = (event: string, data: unknown) => void;
type Bus = { subs: Map<string, Set<Listener>>; presence: Map<string, Map<string, Set<string>>> };
const g = globalThis as unknown as { __bus?: Bus };
const bus = (g.__bus ??= { subs: new Map(), presence: new Map() });

export const teacherReviewChannel = (teacherId: string) => `teacher-review:${teacherId}`;

export function subscribe(channel: string, fn: Listener) {
  let set = bus.subs.get(channel);
  if (!set) bus.subs.set(channel, (set = new Set()));
  set.add(fn);
  return () => { set!.delete(fn); if (!set!.size) bus.subs.delete(channel); };
}

export function publish(channel: string, event: string, data: unknown) {
  bus.subs.get(channel)?.forEach((fn: Listener) => { try { fn(event, data); } catch { /* закрытое соединение */ } });
}

// присутствие — по соединениям, а не счётчиком: при переподключении новое соединение открывается раньше,
// чем сервер заметит обрыв старого; закрытие старого убирает только его, человек остаётся «в классе»
export function join(channel: string, userId: string, conn: string) {
  let m = bus.presence.get(channel);
  if (!m) bus.presence.set(channel, (m = new Map()));
  let set = m.get(userId);
  if (!set) m.set(userId, (set = new Set()));
  set.add(conn);
}
export function leave(channel: string, userId: string, conn: string) {
  const m = bus.presence.get(channel);
  const set = m?.get(userId);
  if (!m || !set) return;
  set.delete(conn);
  if (!set.size) m.delete(userId);
  if (!m.size) bus.presence.delete(channel);
}
export const online = (channel: string) => [...(bus.presence.get(channel)?.keys() ?? [])];

/** Очередь операций по ключу внутри одного процесса приложения. */
const g2 = globalThis as unknown as { __locks?: Map<string, Promise<unknown>> };
const locks = (g2.__locks ??= new Map());
export function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(key) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  const settled = next.catch(() => undefined);
  locks.set(key, settled);
  void settled.then(() => { if (locks.get(key) === settled) locks.delete(key); });
  return next;
}
