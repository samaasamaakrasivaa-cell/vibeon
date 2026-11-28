import { topicOf } from "../tasks/tags";

const focusOptions = {
  "present-questions": {
    label: { ru: "Вопросы в Present Simple (do / does)", en: "Present Simple questions (do / does)" },
    prompt: { ru: "Попросите задать два вопроса о привычках — о собеседнике и о его друге. Проверьте do и does.", en: "Ask for two questions about habits: one about the listener and one about their friend. Listen for do and does." },
    practice: { ru: "Задайте два вопроса о привычках — одному человеку и о другом человеке. Сравните do и does.", en: "Ask two questions about habits: one to someone and one about someone else. Compare do and does." },
  },
  "present-negatives": {
    label: { ru: "Отрицания в Present Simple (don’t / doesn’t)", en: "Present Simple negatives (don’t / doesn’t)" },
    prompt: { ru: "Попросите сравнить привычки двух людей и сказать по одному предложению с don’t и doesn’t.", en: "Ask the student to compare two people's habits using one sentence with don’t and one with doesn’t." },
    practice: { ru: "Скажите, чего обычно не делаете вы и чего не делает ваш друг. Проверьте don’t и doesn’t.", en: "Say what you don’t usually do and what your friend doesn’t usually do. Check don’t and doesn’t." },
  },
  "verb-be": {
    label: { ru: "Формы глагола be (am / is / are)", en: "Forms of be (am / is / are)" },
    prompt: { ru: "Попросите описать незнакомую картинку тремя фразами с am, is и are. Обратите внимание, не пропущен ли глагол.", en: "Ask for three sentences about a new picture using am, is and are. Listen for any omitted verbs." },
    practice: { ru: "Опишите новую картинку тремя фразами с am, is и are. Проверьте, есть ли глагол в каждой фразе.", en: "Describe a new picture in three sentences with am, is and are. Check that each sentence has a verb." },
  },
} as const;

type Preset = keyof typeof focusOptions;
export type ObservationFocus = Preset | `topic:${string}`;

export function observationFocus(value: unknown): ObservationFocus | null {
  if (typeof value !== "string") return null;
  if (Object.hasOwn(focusOptions, value)) return value as Preset;
  return value.startsWith("topic:") && topicOf(value.slice(6)) ? value as `topic:${string}` : null;
}

export const observationFocusOptions = Object.entries(focusOptions);
export function focusDetails(focus: ObservationFocus) {
  if (focus in focusOptions) return focusOptions[focus as Preset];
  const topic = topicOf(focus.slice(6));
  return {
    label: { ru: topic?.topic_ru ?? "", en: topic?.topic_en ?? "" },
    prompt: { ru: "Дайте новый пример по этой теме. Попросите ответить вслух без подсказки и пояснить ответ.", en: "Give a new example for this topic. Ask for an answer aloud without prompting, then ask for an explanation." },
    practice: { ru: "Попробуйте дать свой пример по этой теме вслух и объяснить выбор без подсказки.", en: "Give your own example aloud and explain your choice without looking at your notes." },
  };
}
