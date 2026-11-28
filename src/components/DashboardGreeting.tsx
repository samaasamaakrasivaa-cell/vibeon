import type { ReactNode } from "react";
import { Clock } from "./Clock";

export function DashboardGreeting({ greeting, name, lang, tz, avatar, children }: {
  greeting: string;
  name: string;
  lang: "ru" | "en";
  tz: string;
  avatar?: ReactNode;
  children?: ReactNode;
}) {
  const identity = (
    <div className="min-w-0">
      <div className="text-[19px] text-text2">{greeting}</div>
      <div className="gname [overflow-wrap:anywhere]">{name}</div>
      {children}
    </div>
  );

  return (
    <div className="flex flex-wrap items-center justify-between gap-6 border-b border-sep pb-6">
      {avatar ? <div className="stgreet">{avatar}{identity}</div> : identity}
      <Clock lang={lang} tz={tz} />
    </div>
  );
}
