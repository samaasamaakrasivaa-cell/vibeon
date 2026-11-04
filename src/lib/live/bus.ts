import "server-only";

// Шина событий класса в памяти процесса. Один контейнер приложения — одна шина.
// Для нескольких экземпляров приложения шину переводят на Redis pub/sub (REDIS_URL) без изменения интерфейса.
type Listener = (event: string, data: unknown) => void;
type Bus = { subs: Map<string, Set<Listener>>; presence: Map<string, Map<string, number>> };
const g = globalThis as unknown as { __bus?: Bus };
const bus = (g.__bus ??= { subs: new Map(), presence: new Map() });

export function subscribe(channel: string, fn: Listener) {
  let set = bus.subs.get(channel);
  if (!set) bus.subs.set(channel, (set = new Set()));
  set.add(fn);
  return () => { set!.delete(fn); if (!set!.size) bus.subs.delete(channel); };
}

export function publish(channel: string, event: string, data: unknown) {
  bus.subs.get(channel)?.forEach((fn: Listener) => { try { fn(event, data); } catch { /* закрытое соединение */ } });
}

export function join(channel: string, userId: string) {
  let m = bus.presence.get(channel);
  if (!m) bus.presence.set(channel, (m = new Map()));
  m.set(userId, (m.get(userId) ?? 0) + 1);
}
export function leave(channel: string, userId: string) {
  const m = bus.presence.get(channel);
  if (!m) return;
  const n = (m.get(userId) ?? 1) - 1;
  if (n <= 0) m.delete(userId); else m.set(userId, n);
}
export const online = (channel: string) => [...(bus.presence.get(channel)?.keys() ?? [])];

/** Очередь на ключ: операции с одной доской выполняются строго по очереди (без потери изменений). */
const g2 = globalThis as unknown as { __locks?: Map<string, Promise<unknown>> };
const locks = (g2.__locks ??= new Map());
export function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(key) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  locks.set(key, next.catch(() => {}));
  next.finally(() => { if (locks.get(key) === next) locks.delete(key); }).catch(() => {});
  return next;
}
