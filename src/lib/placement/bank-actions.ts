"use server";
import { revalidatePath } from "next/cache";
import { db } from "../db";
import { requireUser } from "../auth/session";
import { dropBankCache, isOwner, ORIGINAL } from "./bank";
import { json } from "./run";
import type { AnyItem, Q, SpeakItem } from "./engine";

// Правка банка вводного теста — только владелец платформы (OWNER_EMAIL). Уже пройденные тесты не меняются: у них свой снимок.

type R = { ok: true } | { ok: false; error: string };
const s = (v: unknown, max = 6000) => (typeof v === "string" ? v.replace(/\r/g, "").trim().slice(0, max) : "");

async function owner() {
  const me = await requireUser("TEACHER");
  if (!isOwner(me.email)) throw new Error("owner");
  return me;
}

function cleanQs(orig: Q[], qs: unknown): Q[] | string {
  if (!Array.isArray(qs) || qs.length !== orig.length) return "questions";
  const out: Q[] = [];
  for (let i = 0; i < orig.length; i++) {
    const q = qs[i] as Partial<Q>;
    const options = Array.isArray(q.options) ? q.options.map((o) => s(o, 300)) : [];
    if (!s(q.q) || options.length !== orig[i].options.length || options.some((o) => !o)) return `q${i + 1}`;
    const answer = Number(q.answer);
    if (!Number.isInteger(answer) || answer < 0 || answer >= options.length) return `q${i + 1}`;
    out.push({ ...orig[i], q: s(q.q, 600), options, answer, explain_ru: s(q.explain_ru, 600) });
  }
  return out;
}

/** Сохранить правку задания. В data — только поля, которые можно менять у этого типа. */
export async function saveBankItem(itemId: string, data: Record<string, unknown>): Promise<R> {
  let me;
  try { me = await owner(); } catch { return { ok: false, error: "owner" }; }
  const o = ORIGINAL.get(itemId) as AnyItem | undefined;
  if (!o) return { ok: false, error: "item" };
  let patch: Record<string, unknown>;
  if (o.type === "mcq" || o.type === "gap" || o.type === "wordform" || o.type === "transform" || o.type === "brackets") {
    patch = { q: s(data.q, 600), explain_ru: s(data.explain_ru, 600) };
    if (!patch.q || (o.type !== "transform" && !String(patch.q).includes("___"))) return { ok: false, error: "q" };
    if (o.type === "mcq") {
      const options = Array.isArray(data.options) ? data.options.map((x) => s(x, 200)) : [];
      const answer = Number(data.answer);
      if (options.length !== 4 || options.some((x) => !x) || !Number.isInteger(answer) || answer < 0 || answer > 3) return { ok: false, error: "options" };
      Object.assign(patch, { options, answer });
    } else {
      const accept = (Array.isArray(data.accept) ? data.accept : []).map((x) => s(x, 120)).filter(Boolean);
      if (!accept.length) return { ok: false, error: "accept" };
      patch.accept = accept;
      if (o.type === "wordform") patch.base = s(data.base, 40).toUpperCase() || o.base;
      if (o.type === "transform") { patch.key = s(data.key, 40).toUpperCase() || o.key; patch.frame = s(data.frame, 400); if (!String(patch.frame).includes("___")) return { ok: false, error: "frame" }; }
    }
  } else if (o.type === "reading" || o.type === "listening") {
    const qs = cleanQs(o.questions, data.questions);
    if (typeof qs === "string") return { ok: false, error: qs };
    patch = { title: s(data.title, 200) || o.title, questions: qs };
    if (o.type === "reading") { patch.passage = s(data.passage, 8000); if (!patch.passage) return { ok: false, error: "passage" }; }
    else { patch.script = s(data.script, 8000); patch.situation_en = s(data.situation_en, 400); if (!patch.script) return { ok: false, error: "script" }; }
  } else if (o.type === "writing") {
    const min = Number(data.min_words), max = Number(data.max_words);
    if (!s(data.prompt_en) || !(min > 0 && max >= min && max <= 600)) return { ok: false, error: "writing" };
    patch = { prompt_en: s(data.prompt_en, 1500), prompt_ru: s(data.prompt_ru, 1000), min_words: Math.round(min), max_words: Math.round(max), points: (Array.isArray(data.points) ? data.points : []).map((x) => s(x, 300)).filter(Boolean), expects: (Array.isArray(data.expects) ? data.expects : []).map((x) => s(x, 300)).filter(Boolean) };
  } else {
    const sp = o as SpeakItem;
    const qs = Array.isArray(data.questions) ? data.questions : [];
    if (qs.length !== sp.questions.length) return { ok: false, error: "questions" };
    const questions = sp.questions.map((q, i) => {
      const n = qs[i] as { q?: string; prep_sec?: number; speak_sec?: number };
      return { q: s(n.q, 500) || q.q, prep_sec: Math.max(5, Math.min(120, Math.round(Number(n.prep_sec) || q.prep_sec))), speak_sec: Math.max(10, Math.min(240, Math.round(Number(n.speak_sec) || q.speak_sec))) };
    });
    patch = { intro_ru: s(data.intro_ru, 400) || sp.intro_ru, questions, expects: (Array.isArray(data.expects) ? data.expects : []).map((x) => s(x, 300)).filter(Boolean) };
  }
  await db.placementEdit.upsert({ where: { itemId }, create: { itemId, data: json(patch), updatedBy: me.id }, update: { data: json(patch), updatedBy: me.id } });
  dropBankCache();
  revalidatePath("/teacher/placement/bank");
  return { ok: true };
}

/** Вернуть задание к исходному виду (и исходное аудио). */
export async function resetBankItem(itemId: string, onlyAudio = false): Promise<R> {
  try { await owner(); } catch { return { ok: false, error: "owner" }; }
  const e = await db.placementEdit.findUnique({ where: { itemId } });
  if (e) {
    if (onlyAudio && Object.keys((e.data ?? {}) as object).length) await db.placementEdit.update({ where: { itemId }, data: { audio: null } });
    else await db.placementEdit.delete({ where: { itemId } });
  }
  dropBankCache();
  revalidatePath("/teacher/placement/bank");
  return { ok: true };
}
