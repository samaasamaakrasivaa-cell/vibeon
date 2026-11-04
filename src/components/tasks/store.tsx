"use client";
import { createContext, useCallback, useContext, useRef, useState } from "react";

/** Общее хранилище ответов. В конструкторе его нет (состояние локальное), в классе — синхронизируется с сервером. */
export type Answers = Record<string, Record<string, unknown>>;
type Store = { answers: Answers; set: (taskId: string, key: string, value: unknown) => void; role: "teacher" | "student" | "guest" };
const Ctx = createContext<Store | null>(null);

export function AnswerProvider({ answers, onSet, role, children }: { answers: Answers; onSet: (taskId: string, key: string, value: unknown) => void; role: Store["role"]; children: React.ReactNode }) {
  return <Ctx.Provider value={{ answers, set: onSet, role }}>{children}</Ctx.Provider>;
}

export const useTaskRole = () => useContext(Ctx)?.role ?? "guest";

type SetState<T> = (v: T | ((prev: T) => T)) => void;

/** Как useState, но в классе значение берётся из общего хранилища и уходит на сервер. */
export function useSlot<T>(taskId: string, key: string, init: T | (() => T)): [T, SetState<T>] {
  const store = useContext(Ctx);
  const [local, setLocal] = useState<T>(init);
  const initRef = useRef<T | null>(null);
  if (initRef.current === null) initRef.current = typeof init === "function" ? (init as () => T)() : init;
  const remote = store?.answers[taskId]?.[key] as T | undefined;
  const value = store ? (remote !== undefined ? remote : initRef.current) : local;
  const valueRef = useRef(value);
  valueRef.current = value;
  const set = useCallback<SetState<T>>((v) => {
    if (!store) return setLocal(v);
    const next = typeof v === "function" ? (v as (p: T) => T)(valueRef.current) : v;
    valueRef.current = next;
    store.set(taskId, key, next);
  }, [store, taskId, key]);
  return [value, set];
}
