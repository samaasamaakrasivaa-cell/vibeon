"use client";
import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useT } from "@/lib/i18n/client";
import { createGroup, deleteGroup, updateGroup } from "@/lib/teacher/groups";
import { Dialog } from "../Dialog";
import { Icon } from "../Icon";
import { avatarStyle } from "./StudentsGrid";

export type GStudent = { id: string; name: string; initials: string; color: number };
export type GGroup = { id: string; title: string; price: number | null; members: string[] };

/** Группы на странице «Ученики»: создать, выбрать учеников галочками, поставить группу в расписание. */
export function Groups({ groups, students }: { groups: GGroup[]; students: GStudent[] }) {
  const { t } = useT();
  const [edit, setEdit] = useState<GGroup | "new" | null>(null);
  const byId = new Map(students.map((s) => [s.id, s]));
  return (
    <section className="mt-10" id="groups">
      <div className="secthead">
        <h2>{t("grp.title")} <span className="secnum">{groups.length}</span></h2>
        <button type="button" className="btn secondary sm" onClick={() => setEdit("new")} disabled={students.length === 0}><Icon name="plus" size="sm" />{t("grp.create")}</button>
      </div>
      {groups.length === 0 ? (
        <button type="button" className="grp-empty" onClick={() => setEdit("new")} disabled={students.length === 0}>
          <span className="ico"><Icon name="group" /></span>
          <span className="grow"><b>{t("grp.emptyTitle")}</b><small>{students.length ? t("grp.emptySub") : t("grp.noStudents")}</small></span>
          {students.length > 0 && <Icon name="right" />}
        </button>
      ) : (
        <div className="grid-3">
          {groups.map((g) => (
            <div key={g.id} className="grp-card">
              <div className="flex items-center gap-2">
                <span className="grp-ic"><Icon name="group" size="sm" /></span>
                <b className="grow truncate">{g.title}</b>
                <button type="button" className="iconbtn" aria-label={t("grp.edit")} title={t("grp.edit")} onClick={() => setEdit(g)}><Icon name="pencil" size="sm" /></button>
              </div>
              <div className="grp-faces">
                {g.members.slice(0, 6).map((id) => { const s = byId.get(id); return s ? <span key={id} className="avatar" style={avatarStyle(s.color)} title={s.name}>{s.initials}</span> : null; })}
                {g.members.length > 6 && <span className="avatar grp-more">+{g.members.length - 6}</span>}
              </div>
              <div className="small muted grp-names">{g.members.map((id) => byId.get(id)?.name).filter(Boolean).join(", ")}</div>
              <div className="grp-foot">
                <span className="small muted">{t("grp.count", { n: g.members.length })}{g.price ? ` · ${g.price} ₽ ${t("grp.perStudent")}` : ""}</span>
                <Link href={`/teacher/schedule?new=1&group=${g.id}`} className="btn tinted sm"><Icon name="cal" size="sm" />{t("grp.toSchedule")}</Link>
              </div>
            </div>
          ))}
        </div>
      )}
      {edit && <GroupDialog group={edit === "new" ? null : edit} students={students} onClose={() => setEdit(null)} />}
    </section>
  );
}

function GroupDialog({ group, students, onClose }: { group: GGroup | null; students: GStudent[]; onClose: () => void }) {
  const { t } = useT();
  const router = useRouter();
  const [title, setTitle] = useState(group?.title ?? "");
  const [price, setPrice] = useState(group?.price ? String(group.price) : "");
  const [sel, setSel] = useState<Set<string>>(new Set(group?.members ?? []));
  const [q, setQ] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const list = students.filter((s) => s.name.toLowerCase().includes(q.trim().toLowerCase()));
  const toggle = (id: string) => setSel((x) => { const n = new Set(x); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const save = () => start(async () => {
    setErr(null);
    const input = { title, price: Number(price) || null, memberIds: [...sel] };
    const r = await (group ? updateGroup(group.id, input) : createGroup(input)).catch(() => ({ ok: false as const, error: t("pl.err.net") }));
    if (!r.ok) { setErr(r.error); return; }
    router.refresh(); onClose();
  });
  const del = () => {
    if (!group || !confirm(t("grp.delQ", { name: group.title }))) return;
    start(async () => { await deleteGroup(group.id); router.refresh(); onClose(); });
  };
  return (
    <Dialog open onClose={onClose} title={group ? t("grp.edit") : t("grp.create")}>
      <div className="flex flex-col gap-4">
        <label className="field"><span className="flabel">{t("grp.name")}</span>
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t("grp.namePh")} autoFocus maxLength={80} />
        </label>
        <div className="field">
          <span className="flabel">{t("grp.members")} {sel.size > 0 && <span className="text-text3">· {sel.size}</span>}</span>
          {students.length > 6 && <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("stu.search")} aria-label={t("stu.search")} />}
          <div className="grp-pick">
            {list.map((s) => (
              <label key={s.id} className={`grp-row ${sel.has(s.id) ? "on" : ""}`}>
                <span className="avatar" style={avatarStyle(s.color)}>{s.initials}</span>
                <span className="grow truncate">{s.name}</span>
                <input type="checkbox" checked={sel.has(s.id)} onChange={() => toggle(s.id)} aria-label={s.name} />
              </label>
            ))}
            {list.length === 0 && <p className="hint m-0 p-3">{t("stu.nothing")}</p>}
          </div>
        </div>
        <label className="field"><span className="flabel">{t("grp.price")}</span>
          <input className="input" inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value.replace(/\D/g, "").slice(0, 7))} placeholder={t("grp.pricePh")} />
          <span className="hint">{t("grp.priceHint")}</span>
        </label>
        {group && <p className="hint m-0">{t("grp.membersHint")}</p>}
        {err && <div className="alert" role="alert">{err}</div>}
      </div>
      <div className="actions" style={{ justifyContent: "space-between" }}>
        <div>{group && <button type="button" className="btn danger sm" disabled={pending} onClick={del}>{t("common.delete")}</button>}</div>
        <div className="flex gap-2">
          <button type="button" className="btn secondary" onClick={onClose}>{t("common.cancel")}</button>
          <button type="button" className="btn primary" disabled={pending || !title.trim() || sel.size === 0} onClick={save}>{group ? t("common.save") : t("grp.createBtn")}</button>
        </div>
      </div>
    </Dialog>
  );
}
