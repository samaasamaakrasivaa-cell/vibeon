"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { Icon } from "../Icon";

/** Поиск по имени через параметр ?q= (для серверных списков). */
export function StudentsSearch({ placeholder }: { placeholder: string }) {
  const router = useRouter();
  const sp = useSearchParams();
  return (
    <label className="searchbox">
      <Icon name="search" size="sm" />
      <input className="input" placeholder={placeholder} defaultValue={sp.get("q") ?? ""} aria-label={placeholder}
        onChange={(e) => { const p = new URLSearchParams(sp.toString()); if (e.target.value) p.set("q", e.target.value); else p.delete("q"); router.replace(`?${p}`); }} />
    </label>
  );
}
