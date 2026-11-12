import "server-only";
import { db } from "../db";
import { fileUrl } from "../storage";
import type { AnyItem, Bank, CoreItem, Family, Group, ListenItem, ReadItem, SpeakItem, WriteItem } from "./engine";
import c1 from "../../../content/placement/01_core_A1.json";
import c2 from "../../../content/placement/02_core_A2.json";
import c3 from "../../../content/placement/03_core_B1.json";
import c4 from "../../../content/placement/04_core_B2.json";
import c5 from "../../../content/placement/05_core_C1.json";
import r1 from "../../../content/placement/06_reading_A1_A2.json";
import r2 from "../../../content/placement/07_reading_B1.json";
import r3 from "../../../content/placement/08_reading_B2.json";
import r4 from "../../../content/placement/09_reading_C1.json";
import l1 from "../../../content/placement/10_listening_A1_A2.json";
import l2 from "../../../content/placement/11_listening_B1.json";
import l3 from "../../../content/placement/12_listening_B2.json";
import l4 from "../../../content/placement/13_listening_C1.json";
import ws from "../../../content/placement/14_writing_speaking.json";
import rubricsJson from "../../../content/placement/15_rubrics.json";
import instructionsJson from "../../../content/placement/00_instructions.json";
import groupsJson from "../../../content/placement/00_groups.json";
import familiesJson from "../../../content/placement/00_families.json";
// Placement test Teens — отдельный банк (10–17 лет, уровни до B2+, небольшой запас C1)
import tc1 from "../../../content/placement/teen/01_core_A1.json";
import tc2 from "../../../content/placement/teen/02_core_A2.json";
import tc3 from "../../../content/placement/teen/03_core_B1.json";
import tc4 from "../../../content/placement/teen/04_core_B2.json";
import tc5 from "../../../content/placement/teen/05_core_C1.json";
import tr from "../../../content/placement/teen/06_reading.json";
import tl from "../../../content/placement/teen/10_listening.json";
import tws from "../../../content/placement/teen/14_writing_speaking.json";
import tGroupsJson from "../../../content/placement/teen/00_groups.json";
import tFamiliesJson from "../../../content/placement/teen/00_families.json";
import tInstructionsJson from "../../../content/placement/teen/00_instructions.json";

// Банк вводного теста: файлы content/placement + правки владельца платформы (таблица PlacementEdit).

export const audioUrl = (name: string) => `/api/placement/audio/${name}.mp3`;

const FILE_ITEMS: AnyItem[] = [
  ...([c1, c2, c3, c4, c5].flat() as unknown as CoreItem[]),
  ...([r1, r2, r3, r4].flat() as unknown as ReadItem[]),
  ...([l1, l2, l3, l4].flat() as unknown as ListenItem[]),
  ...(ws as unknown as (WriteItem | SpeakItem)[]),
];
export type Track = "adult" | "teen";
export const trackOf = (v: unknown): Track => (v === "teen" ? "teen" : "adult");
const TEEN_ITEMS: AnyItem[] = [
  ...([tc1, tc2, tc3, tc4, tc5].flat() as unknown as CoreItem[]),
  ...(tr as unknown as ReadItem[]),
  ...(tl as unknown as ListenItem[]),
  ...(tws as unknown as (WriteItem | SpeakItem)[]),
];
export const GROUPS = groupsJson as unknown as Group[];
export const TEEN_GROUPS = tGroupsJson as unknown as Group[];
const withGroups = (items: AnyItem[], groups: Group[]) => {
  const of = new Map(groups.flatMap((g) => g.topics.map((t) => [t, g.id] as const)));
  for (const x of items) if (x.skill === "grammar" || x.skill === "vocabulary") (x as CoreItem).group = (x as CoreItem).group ?? of.get((x as CoreItem).topic_id);
};
withGroups(FILE_ITEMS, GROUPS);
withGroups(TEEN_ITEMS, TEEN_GROUPS);
export const ORIGINAL = new Map([...FILE_ITEMS, ...TEEN_ITEMS].map((x) => [x.id, x]));
export const TEEN_IDS = new Set(TEEN_ITEMS.map((x) => x.id));
/** Банк Teens готов к работе: есть задания грамматики на всех уровнях A1–B2. Пока нет — версию видит только владелец. */
export const TEEN_READY = ["A1", "A2", "B1", "B2"].every((l) => TEEN_ITEMS.some((x) => x.level === l && x.skill === "grammar"));

export type Rubric = { id: string; name_ru: string; levels: Record<string, string> };
export const RUBRICS = rubricsJson as unknown as { speaking: { criteria: Rubric[] }; writing: { criteria: Rubric[] }; sublevels_ru: string; how_to_decide_ru: string; total_ru: string; scores_ru: Record<string, string> };
const INS = instructionsJson as Record<string, { easy: string; std: string }>;
const T_INS = tInstructionsJson as Record<string, { easy: string; std: string; ru: string }>;
const low = (level?: string) => level === "A1" || level === "A2";
/** Формулировка задания — по-английски; на A1–A2 — проще. */
export const instruction = (type: string, level?: string, track: Track = "adult") => ((track === "teen" ? T_INS : INS)[type]?.[low(level) ? "easy" : "std"]) ?? "";
/** Teens, уровни A1–A2: перевод инструкции на русский («ты»). */
export const instructionRu = (type: string, level?: string, track: Track = "adult") => (track === "teen" && low(level) ? T_INS[type]?.ru ?? "" : "");

const caches: Partial<Record<Track, { at: number; bank: Bank; edited: Set<string> }>> = {};
export const dropBankCache = () => { delete caches.adult; delete caches.teen; };

/** Задание с правками владельца и ссылками на аудио. */
function withAudio(x: AnyItem, audio: string | null | undefined): AnyItem {
  if (x.type === "listening") return { ...x, audio: audio ? fileUrl(audio) : audioUrl(x.id) };
  if (x.type === "speaking") {
    const orig = ORIGINAL.get(x.id) as SpeakItem | undefined;
    // озвучка вопроса годится, только если текст вопроса не меняли
    return { ...x, questions: x.questions.map((q, i) => ({ ...q, audio: orig?.questions[i]?.q === q.q ? audioUrl(`${x.id}-q${i + 1}`) : null })) };
  }
  return x;
}

export async function getBank(track: Track = "adult"): Promise<{ bank: Bank; edited: Set<string> }> {
  const cache = caches[track];
  if (cache && Date.now() - cache.at < 60_000) return cache;
  const edits = new Map((await db.placementEdit.findMany()).map((e) => [e.itemId, e]));
  const items = (track === "teen" ? TEEN_ITEMS : FILE_ITEMS).map((x) => {
    const e = edits.get(x.id);
    return withAudio(e ? ({ ...x, ...(e.data as object), id: x.id, type: x.type, skill: x.skill, level: x.level } as AnyItem) : x, e?.audio);
  });
  const bank: Bank = {
    groups: track === "teen" ? TEEN_GROUPS : GROUPS,
    families: (track === "teen" ? tFamiliesJson : familiesJson) as unknown as Family[],
    core: items.filter((x): x is CoreItem => x.skill === "grammar" || x.skill === "vocabulary"),
    reading: items.filter((x): x is ReadItem => x.type === "reading"),
    listening: items.filter((x): x is ListenItem => x.type === "listening"),
    writing: items.filter((x): x is WriteItem => x.type === "writing"),
    speaking: items.filter((x): x is SpeakItem => x.type === "speaking"),
  };
  const fresh = { at: Date.now(), bank, edited: new Set(edits.keys()) };
  caches[track] = fresh;
  return fresh;
}

export const isOwner = (email?: string | null) =>
  !!email && (process.env.OWNER_EMAIL ?? "").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean).includes(email.toLowerCase());
