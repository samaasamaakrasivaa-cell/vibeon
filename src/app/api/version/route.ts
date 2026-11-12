import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** Метка текущей сборки — открытые вкладки сравнивают её со своей и предлагают обновиться. */
export function GET() {
  return NextResponse.json({ v: process.env.NEXT_PUBLIC_BUILD ?? "" }, { headers: { "Cache-Control": "no-store" } });
}
