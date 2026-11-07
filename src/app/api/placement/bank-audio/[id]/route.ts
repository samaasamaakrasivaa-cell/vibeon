import { NextResponse, type NextRequest } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { dropBankCache, isOwner, ORIGINAL } from "@/lib/placement/bank";
import { saveFile } from "@/lib/storage";

/** Владелец платформы заменяет озвучку записи аудирования своим файлом (mp3 и др.). */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user || !isOwner(user.email)) return NextResponse.json({ error: "owner" }, { status: 403 });
  const id = (await params).id;
  if (ORIGINAL.get(id)?.type !== "listening") return NextResponse.json({ error: "item" }, { status: 400 });
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File) || file.size < 1000 || file.size > 30 * 1024 * 1024) return NextResponse.json({ error: "file" }, { status: 400 });
  if (!/^audio\/(mpeg|mp3|mp4|ogg|wav|x-wav|webm|x-m4a|aac)$/.test(file.type)) return NextResponse.json({ error: "type" }, { status: 415 });
  const mime = file.type === "audio/mp3" ? "audio/mpeg" : file.type === "audio/x-wav" ? "audio/wav" : file.type;
  const key = await saveFile(Buffer.from(await file.arrayBuffer()), mime);
  // ученики слушают через /api/files — нужна запись в Upload
  await db.upload.create({ data: { ownerId: user.id, path: key, name: file.name.slice(0, 200), mime, size: file.size } });
  await db.placementEdit.upsert({ where: { itemId: id }, create: { itemId: id, data: {}, audio: key, updatedBy: user.id }, update: { audio: key, updatedBy: user.id } });
  dropBankCache();
  return NextResponse.json({ ok: true });
}
