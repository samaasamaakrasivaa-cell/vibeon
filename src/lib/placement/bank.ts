import "server-only";
import { db } from "../db";
import { fileUrl } from "../storage";
import type { AnyItem, Bank, CoreItem, Group, ListenItem, ReadItem, SpeakItem, WriteItem } from "./engine";
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

// Банк вводного теста: файлы content/placement + правки владельца платформы (таблица PlacementEdit).

export const audioUrl = (name: string) => `/api/placement/audio/${name}.mp3`;

const FILE_ITEMS: AnyItem[] = [
  ...([c1, c2, c3, c4, c5].flat() as unknown as CoreItem[]),
  ...([r1, r2, r3, r4].flat() as unknown as ReadItem[]),
  ...([l1, l2, l3, l4].flat() as unknown as ListenItem[]),
  ...(ws as unknown as (WriteItem | SpeakItem)[]),
];
export const GROUPS = groupsJson as unknown as Group[];
const GROUP_OF = new Map(GROUPS.flatMap((g) => g.topics.map((t) => [t, g.id] as const)));
for (const x of FILE_ITEMS) if (x.skill === "grammar" || x.skill === "vocabulary") (x as CoreItem).group = GROUP_OF.get((x as CoreItem).topic_id);
export const ORIGINAL = new Map(FILE_ITEMS.map((x) => [x.id, x]));

export type Rubric = { id: string; name_ru: string; levels: Record<string, string> };
export const RUBRICS = rubricsJson as unknown as { speaking: { criteria: Rubric[] }; writing: { criteria: Rubric[] }; sublevels_ru: string; how_to_decide_ru: string; total_ru: string; scores_ru: Record<string, string> };
export const INSTRUCTIONS = instructionsJson as Record<string, { ru: string; en: string }>;

let cache: { at: number; bank: Bank; edited: Set<string> } | null = null;
export const dropBankCache = () => { cache = null; };

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

export async function getBank(): Promise<{ bank: Bank; edited: Set<string> }> {
  if (cache && Date.now() - cache.at < 60_000) return cache;
  const edits = new Map((await db.placementEdit.findMany()).map((e) => [e.itemId, e]));
  const items = FILE_ITEMS.map((x) => {
    const e = edits.get(x.id);
    return withAudio(e ? ({ ...x, ...(e.data as object), id: x.id, type: x.type, skill: x.skill, level: x.level } as AnyItem) : x, e?.audio);
  });
  const bank: Bank = {
    groups: GROUPS,
    core: items.filter((x): x is CoreItem => x.skill === "grammar" || x.skill === "vocabulary"),
    reading: items.filter((x): x is ReadItem => x.type === "reading"),
    listening: items.filter((x): x is ListenItem => x.type === "listening"),
    writing: items.filter((x): x is WriteItem => x.type === "writing"),
    speaking: items.filter((x): x is SpeakItem => x.type === "speaking"),
  };
  cache = { at: Date.now(), bank, edited: new Set(edits.keys()) };
  return cache;
}

export const isOwner = (email?: string | null) =>
  !!email && (process.env.OWNER_EMAIL ?? "").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean).includes(email.toLowerCase());
