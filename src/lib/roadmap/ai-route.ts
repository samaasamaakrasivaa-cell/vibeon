"use server";
// Маршрут v2 с ИИ: «Что я понял» (по комплекту разбора и аккаунту) → анкета учителя → маршрут из участков и точек →
// правки в диалоге (с версиями) → подсказки к точке и утверждённое учителем. Имена и контакты в ИИ не уходят.
import { revalidatePath } from "next/cache";
import type { Prisma } from "@prisma/client";
import { db } from "../db";
import { requireUser } from "../auth/session";
import { getT } from "../i18n/server";
import { llmFor } from "../ai/gateway";
import { modelLabel, modelsFor } from "../ai/models";
import { prompt } from "../ai/prompts";
import { scrubWithMap } from "../ai/check-core";
import { BRIEF_KEYS, cleanInsight, cleanRecs, cleanRoute, compactStages, REC_LISTS, REC_TEXTS, ROUTE_TYPE, runJson, settleHours, toStages, type Insight, type Point, type PointOk } from "../ai/route-core";
import { aiCode, aiCtx } from "../ai/ctx";
import { goalLevel, hoursTo, LEVELS, ROUTE_TYPES, type Stage } from "./cefr";
import { paceKey, PACES, parsePace } from "./math";
import { lessonMinOf } from "./progress";
import { accountStats, testPack } from "./pack";
import type { RoadmapForm } from "./actions";

type R = { ok: true; id?: string; note?: string } | { ok: false; error: string };
const json = (v: unknown) => JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;
const str = (v: unknown, max = 2000) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const refresh = (sid: string) => { revalidatePath(`/teacher/students/${sid}`); revalidatePath("/student/route"); revalidatePath("/student"); };

/** Анкета учителя: рубрики (текст) + короткие поля. */
export type Brief = Partial<Record<(typeof BRIEF_KEYS)[number], string>> & {
  marks?: Record<string, "strong" | "norm" | "weak">; order?: string[]; breaks?: string; variant?: "br" | "am" | "any"; exam?: string;
};
export type InsightSaved = Insight & { model?: string; label?: string; at?: string; edited?: boolean };
export type ChatMsg = { role: "teacher" | "ai"; text: string; at: string };

function cleanBrief(b: Brief): Brief {
  const out: Brief = {};
  for (const k of BRIEF_KEYS) { const v = str(b?.[k], 4000); if (v) out[k] = v; }
  const marks = Object.fromEntries(Object.entries(b?.marks ?? {}).filter(([k, v]) => /^[a-z]{4,12}$/.test(k) && ["strong", "norm", "weak"].includes(v)));
  if (Object.keys(marks).length) out.marks = marks as Brief["marks"];
  const pr = (b?.order ?? []).filter((x) => /^[a-z]{4,12}$/.test(x)).slice(0, 6);
  if (pr.length) out.order = pr;
  if (str(b?.breaks, 300)) out.breaks = str(b.breaks, 300);
  if (b?.variant && ["br", "am", "any"].includes(b.variant)) out.variant = b.variant;
  if (str(b?.exam, 40)) out.exam = str(b.exam, 40);
  return out;
}

async function own(studentId: string) {
  const me = await requireUser("TEACHER");
  const s = await db.student.findUnique({ where: { id: studentId } });
  if (!s || s.teacherId !== me.id) throw new Error("not found");
  return { me, s };
}

/** Черновик маршрута ученика (создаётся с анкетой, если маршрута ещё нет). */
async function roadmapOf(studentId: string, f: RoadmapForm) {
  const cur = await db.roadmap.findFirst({ where: { studentId }, orderBy: { createdAt: "desc" } });
  if (cur) return cur;
  const type = ROUTE_TYPES[f.type] ? f.type : "ge";
  return db.roadmap.create({ data: { studentId, type, goal: str(f.goal, 80) || ROUTE_TYPES[type].goals[0], fromLevel: f.fromLevel || null, pace: f.pace || "2:20", mood: f.mood || "plan" } });
}

/** Параметры маршрута из формы (тип, цель, точка A, срок, темп). */
function routeParams(f: RoadmapForm, fallbackFrom: string) {
  const type = ROUTE_TYPES[f.type] ? f.type : "ge";
  const goal = str(f.goal, 80) || ROUTE_TYPES[type].goals[0];
  const from = (LEVELS as readonly string[]).includes(f.fromLevel) ? f.fromLevel : fallbackFrom;
  const pace = PACES.some((p) => paceKey(p) === f.pace) ? f.pace : "2:20";
  return { type, goal, from, pace, gl: goalLevel(type, goal) };
}

/** Всё, что ИИ читает об ученике: комплект разбора, динамика, анкета ученика, параметры маршрута. Без имён и контактов. */
async function context(studentId: string, teacherId: string, f: RoadmapForm, brief: Brief) {
  const s = await db.student.findUniqueOrThrow({ where: { id: studentId } });
  const [pack, account, lessonMin] = await Promise.all([testPack(studentId, teacherId), accountStats(studentId), lessonMinOf(studentId)]);
  const p = routeParams(f, pack?.level?.match(/[ABC][12]\+?/)?.[0] ?? s.level?.match(/[ABC][12]\+?/)?.[0] ?? "B1");
  const pc = parsePace(p.pace);
  const days = f.mood === "slack" ? 5 : 7;
  const weekly = (pc.lessons * lessonMin + pc.min * days) / 60;
  const form = Object.fromEntries(Object.entries((s.form ?? {}) as Record<string, unknown>)
    .filter(([k, v]) => typeof v === "string" && v.trim() && !/phone|mail|tel|contact|parent|payer|name|birth|source|price|nick|tg|telegram/i.test(k))
    .map(([k, v]) => [k, String(v).slice(0, 400)]));
  const age = s.birthday ? Math.floor((Date.now() - s.birthday.getTime()) / (365.25 * 864e5)) : null;
  // нормы часов между подуровнями от точки A до цели
  const L = LEVELS as readonly string[];
  const a = L.indexOf(p.from), b = L.indexOf(p.gl);
  const hours_guide = a >= 0 && b > a ? Object.fromEntries(L.slice(a, b).map((x, i) => [`${x} → ${L[a + i + 1]}`, hoursTo(L[a + i + 1]) - hoursTo(x)])) : {};
  const route = {
    type: ROUTE_TYPE[p.type] ?? "general", goal: p.goal, goal_level: p.gl, from_level: p.from,
    deadline: f.deadline ?? null,
    weeks_until_deadline: f.deadline ? Math.max(0, Math.round((new Date(`${f.deadline}-01T00:00:00Z`).getTime() - Date.now()) / (7 * 864e5))) : null,
    pace: { lessons_per_week: pc.lessons, lesson_minutes: lessonMin, daily_minutes: pc.min, active_days: days },
    teacher_notes: str(f.note, 1500),
  };
  const lead = f.leadCourseId ? await db.course.findFirst({ where: { id: f.leadCourseId, teacherId }, select: { title: true, units: { orderBy: { order: "asc" }, select: { title: true, outcomes: true } } } }) : null;
  const raw = { pack, account, student: { age, form }, route, brief, hours_guide, courses: lead ? { leading: lead.title, units: lead.units.map((u) => ({ title: u.title, outcomes: u.outcomes.slice(0, 6) })) } : null };
  // имена ученика не уходят в ИИ
  const names = [s.name, s.lastName].filter(Boolean) as string[];
  const scrubbed = JSON.parse(scrubWithMap(JSON.stringify(raw), names).text);
  return { input: scrubbed as Record<string, unknown>, weekly, p, pack };
}

/** Анкета сохраняется сама (с задержкой) — ничего не теряется до «Создать черновик». */
export async function saveBrief(studentId: string, f: RoadmapForm, brief: Brief): Promise<R> {
  await own(studentId);
  const r = await roadmapOf(studentId, f);
  await db.roadmap.update({ where: { id: r.id }, data: { brief: json(cleanBrief(brief)) } });
  return { ok: true };
}

/** «Что я понял»: ИИ читает комплект разбора и аккаунт, делает вывод и предзаполняет анкету. */
export async function routeInsight(studentId: string, f: RoadmapForm, brief: Brief): Promise<R> {
  const { me } = await own(studentId);
  const { t } = await getT();
  const r = await roadmapOf(studentId, f);
  const b = cleanBrief(brief);
  const { input, pack } = await context(studentId, me.id, f, b);
  if (!pack && !(await db.checkpoint.count({ where: { studentId, status: "done" } }))) return { ok: false, error: t("rm2.needTest") };
  try {
    const run = await runJson(llmFor("route", await aiCtx(me)), modelsFor("route"), prompt("route-insight"), input, cleanInsight, { tag: "route-insight", maxTokens: 5000, temperature: 0.2 });
    const saved: InsightSaved = { ...run.data, model: run.model, label: modelLabel(run.model), at: new Date().toISOString() };
    await db.roadmap.update({ where: { id: r.id }, data: { insight: json(saved), brief: json(b) } });
    refresh(studentId);
    return { ok: true };
  } catch (e) { console.error("[ai:route-insight]", e); return { ok: false, error: t(`ai.err.${aiCode(e)}`) }; }
}

/** Учитель поправил «Что я понял»: текст вывода и список пробелов (порядок, удаление). */
export async function saveInsight(studentId: string, patch: { summary: string; gaps: Insight["gaps"] }): Promise<R> {
  await own(studentId);
  const r = await db.roadmap.findFirst({ where: { studentId }, orderBy: { createdAt: "desc" } });
  if (!r?.insight) return { ok: false, error: "no insight" };
  const cur = r.insight as InsightSaved;
  const gaps = (patch.gaps ?? []).slice(0, 20).map((g, i) => ({ topic: str(g.topic, 160), level: str(g.level, 8), priority: i + 1, why: str(g.why, 400) })).filter((g) => g.topic);
  await db.roadmap.update({ where: { id: r.id }, data: { insight: json({ ...cur, summary: str(patch.summary, 3000), gaps, edited: true }) } });
  refresh(studentId);
  return { ok: true };
}

const pushVersion = (versions: unknown, r: { stages: unknown; aiDraft: unknown }, note: string) =>
  [{ at: new Date().toISOString(), note, stages: r.stages, aiDraft: r.aiDraft }, ...((versions as unknown[]) ?? [])].slice(0, 20);

/** Сохранить черновик ИИ в маршрут: часы считает платформа, подсказки и утверждённое в точках сохраняются. */
async function saveDraft(rid: string, run: { data: ReturnType<typeof cleanRoute>; model: string; ms: number; fallbackFrom?: string }, weekly: number, gl: string, prev: Stage[], extra: Prisma.RoadmapUpdateInput) {
  const d = settleHours(run.data, weekly, hoursTo);
  const stages = toStages(d, gl, prev);
  const lastCp = d.segments[d.segments.length - 1]?.checkpoint?.pass_rule;
  const aiDraft = { model: run.model, label: modelLabel(run.model), fallbackFrom: run.fallbackFrom ?? null, ms: run.ms, start: d.start, goal: d.goal, weekly_hours: d.weekly_hours, total_hours: d.total_hours, forecast_weeks: d.forecast_weeks, deadline_check: d.deadline_check, risks: d.risks, pace_options: d.pace_options, student_message: d.student_message, changes: d.changes, at: new Date().toISOString(), v: 2 };
  await db.roadmap.update({ where: { id: rid }, data: { ...extra, stages: json(stages), criteria: json([d.goal.explanation, lastCp].filter(Boolean)), summary: d.teacher_summary || null, aiDraft: json(aiDraft), builtAt: new Date(), approvedAt: null } });
  return d;
}

/** «Создать черновик»: маршрут из участков и точек по выводу, анкете и комплекту разбора. */
export async function buildRoadmap(studentId: string, f: RoadmapForm, brief: Brief = {}): Promise<R> {
  const { me } = await own(studentId);
  const { t } = await getT();
  const r0 = await roadmapOf(studentId, f);
  const b = cleanBrief(brief);
  const { input, weekly, p } = await context(studentId, me.id, f, b);
  const ins = r0.insight as InsightSaved | null;
  if (ins) input.insight = { summary: ins.summary, blockers: ins.blockers, strengths: ins.strengths, gaps: ins.gaps, skills: ins.skills, dynamics: ins.dynamics };
  try {
    const run = await runJson(llmFor("route", await aiCtx(me)), modelsFor("route"), prompt("route"), input, cleanRoute, { tag: "route", maxTokens: 9000, timeoutMs: 280000 });
    const courseIds = (await db.course.findMany({ where: { teacherId: me.id, id: { in: f.courseIds ?? [] } }, select: { id: true } })).map((c) => c.id);
    const lead = f.leadCourseId && courseIds.includes(f.leadCourseId) ? f.leadCourseId : null;
    const units = lead ? await db.unit.findMany({ where: { courseId: lead }, orderBy: { order: "asc" }, select: { title: true, outcomes: true } }) : [];
    await saveDraft(r0.id, run, weekly, p.gl, (r0.stages as Stage[]) ?? [], {
      type: p.type, goal: p.goal, fromLevel: p.from, deadline: f.deadline ? new Date(`${f.deadline}-01T00:00:00Z`) : null, showDate: !!f.deadline && !!f.showDate, pace: p.pace,
      mood: ["plan", "more", "slack"].includes(f.mood) ? f.mood : "plan", note: str(f.note, 2000) || null, courseIds, leadCourseId: lead, units: json(units),
      brief: json(b), versions: json(r0.builtAt ? pushVersion(r0.versions, r0, "before rebuild") : r0.versions ?? []),
      chat: json(r0.builtAt ? [...((r0.chat as ChatMsg[]) ?? []), { role: "ai", text: t("rm2.rebuilt"), at: new Date().toISOString() }] : []),
    });
    await db.checkpoint.updateMany({ where: { studentId, roadmapId: null }, data: { roadmapId: r0.id } });
    refresh(studentId);
    return { ok: true, id: r0.id };
  } catch (e) { console.error("[ai:route]", e); return { ok: false, error: t(`ai.err.${aiCode(e)}`) }; }
}

/** Диалог под черновиком: учитель просит изменить — ИИ обновляет маршрут и пишет, что изменил. Прежняя версия сохраняется. */
export async function refineRoadmap(roadmapId: string, text: string): Promise<R> {
  const r = await db.roadmap.findUnique({ where: { id: roadmapId } });
  if (!r) return { ok: false, error: "not found" };
  const { me } = await own(r.studentId);
  const { t } = await getT();
  const msg = str(text, 3000);
  if (!msg) return { ok: false, error: t("rm2.emptyMsg") };
  const f: RoadmapForm = { type: r.type, goal: r.goal, fromLevel: r.fromLevel ?? "", courseIds: r.courseIds, leadCourseId: r.leadCourseId, deadline: r.deadline ? r.deadline.toISOString().slice(0, 7) : null, showDate: r.showDate, pace: r.pace ?? "2:20", mood: r.mood ?? "plan", note: r.note ?? "" };
  const { input, weekly, p } = await context(r.studentId, me.id, f, (r.brief ?? {}) as Brief);
  const ins = r.insight as InsightSaved | null;
  if (ins) input.insight = { summary: ins.summary, blockers: ins.blockers, gaps: ins.gaps };
  const chat = (r.chat as ChatMsg[]) ?? [];
  input.current_route = compactStages((r.stages as Stage[]) ?? []);
  input.dialog = chat.slice(-8).map((m) => ({ role: m.role, text: m.text.slice(0, 800) }));
  input.teacher_request = msg;
  const now = new Date().toISOString();
  try {
    const run = await runJson(llmFor("route", await aiCtx(me)), modelsFor("route"), prompt("route"), input, cleanRoute, { tag: "route-refine", maxTokens: 9000, timeoutMs: 280000 });
    const d = await saveDraft(r.id, run, weekly, p.gl, (r.stages as Stage[]) ?? [], {
      versions: json(pushVersion(r.versions, r, msg.slice(0, 120))),
      chat: json([...chat, { role: "teacher", text: msg, at: now }, { role: "ai", text: run.data.changes || t("rm2.updated"), at: new Date().toISOString() }].slice(-60)),
    });
    refresh(r.studentId);
    return { ok: true, note: d.changes };
  } catch (e) {
    console.error("[ai:route-refine]", e);
    await db.roadmap.update({ where: { id: r.id }, data: { chat: json([...chat, { role: "teacher", text: msg, at: now }].slice(-60)) } });
    return { ok: false, error: t(`ai.err.${aiCode(e)}`) };
  }
}

/** Вернуть прежнюю версию черновика (текущая сама уходит в версии). */
export async function restoreVersion(roadmapId: string, i: number): Promise<R> {
  const r = await db.roadmap.findUnique({ where: { id: roadmapId } });
  if (!r) return { ok: false, error: "not found" };
  await own(r.studentId);
  const vs = (r.versions as { at: string; note: string; stages: unknown; aiDraft: unknown }[]) ?? [];
  const v = vs[i];
  if (!v) return { ok: false, error: "version" };
  const rest = vs.filter((_, k) => k !== i);
  await db.roadmap.update({ where: { id: r.id }, data: { stages: json(v.stages), aiDraft: json(v.aiDraft), approvedAt: null, versions: json(pushVersion(rest, r, "before restore")) } });
  refresh(r.studentId);
  return { ok: true };
}

function findPoint(stages: Stage[], pointId: string) {
  for (const s of stages) { const p = (s.points ?? []).find((x) => x.id === pointId); if (p) return p; }
  return null;
}

/** Подсказки к точке: что подсадить вокруг главной грамматики (видит только учитель). */
export async function suggestPoint(roadmapId: string, pointId: string): Promise<R> {
  const r = await db.roadmap.findUnique({ where: { id: roadmapId } });
  if (!r) return { ok: false, error: "not found" };
  const { me } = await own(r.studentId);
  const { t } = await getT();
  const stages = (r.stages as Stage[]) ?? [];
  const p = findPoint(stages, pointId);
  if (!p) return { ok: false, error: "point" };
  const b = (r.brief ?? {}) as Brief;
  const input = {
    point: { title: p.title, level: p.level, why: p.why, focus: p.focus },
    student: { level: r.fromLevel, goal: r.goal, interests: b.interests ?? "", background: b.background ?? "", goal_details: b.goal ?? "" },
    materials: b.materials ?? "", already_approved: p.ok ?? {},
  };
  try {
    const run = await runJson(llmFor("route", await aiCtx(me)), modelsFor("route"), prompt("route-point"), input, cleanRecs, { tag: "route-point", maxTokens: 2500 });
    p.recs = run.data;
    await db.roadmap.update({ where: { id: r.id }, data: { stages: json(stages) } });
    refresh(r.studentId);
    return { ok: true };
  } catch (e) { console.error("[ai:route-point]", e); return { ok: false, error: t(`ai.err.${aiCode(e)}`) }; }
}

/** Учитель утверждает / дописывает содержимое точки — это видно ученику. Можно поправить название и часы. */
export async function savePoint(roadmapId: string, pointId: string, patch: { ok?: PointOk; title?: string; hours?: number }): Promise<R> {
  const r = await db.roadmap.findUnique({ where: { id: roadmapId } });
  if (!r) return { ok: false, error: "not found" };
  await own(r.studentId);
  const stages = (r.stages as Stage[]) ?? [];
  const p = findPoint(stages, pointId);
  if (!p) return { ok: false, error: "point" };
  if (patch.ok) {
    const ok: PointOk = {};
    const o = ok as Record<string, unknown>;
    for (const k of REC_LISTS) { const v = (patch.ok[k] ?? []).map((x) => str(x, 160)).filter(Boolean).slice(0, 30); if (v.length) o[k] = v; }
    for (const k of REC_TEXTS) { const v = str(patch.ok[k], 800); if (v) o[k] = v; }
    if (str(patch.ok.note, 2000)) ok.note = str(patch.ok.note, 2000);
    p.ok = ok;
  }
  if (patch.title !== undefined && str(patch.title, 160)) p.title = str(patch.title, 160);
  if (patch.hours !== undefined && patch.hours >= 1 && patch.hours <= 60) p.hours = Math.round(patch.hours);
  // часы участка = сумма точек
  for (const s of stages) if (s.points?.length) { s.hours = s.points.reduce((a, x) => a + x.hours, 0); s.grammar = s.points.map((x) => x.title); }
  await db.roadmap.update({ where: { id: r.id }, data: { stages: json(stages) } });
  refresh(r.studentId);
  return { ok: true };
}

export type { Point };
