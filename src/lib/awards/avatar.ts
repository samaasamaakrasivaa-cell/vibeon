import "server-only";
import { db } from "../db";
import { fileUrl, saveFile } from "../storage";
import { tgProfilePhoto } from "../notify/telegram";

/** Фото из Telegram на аватарку ученика. auto — только если ученик ещё сам ничего не выбрал;
 *  ставим и просим подтвердить («мы взяли фото из Telegram — оставить или заменить?»). true — фото поставлено. */
export async function takeTgAvatar(studentId: string, auto = true): Promise<boolean> {
  const s = await db.student.findUnique({ where: { id: studentId }, select: { id: true, avatar: true, userId: true, user: { select: { telegramChatId: true } } } });
  const chat = s?.user?.telegramChatId;
  if (!s || !chat || !s.userId) return false;
  if (auto && s.avatar) { await db.student.update({ where: { id: s.id }, data: { tgPhotoChecked: true } }); return false; }
  const ph = await tgProfilePhoto(chat).catch(() => null);
  if (!ph) { await db.student.update({ where: { id: s.id }, data: { tgPhotoChecked: true } }); return false; }
  const key = await saveFile(ph.buf, ph.mime);
  await db.upload.create({ data: { ownerId: s.userId, path: key, name: "telegram.jpg", mime: ph.mime, size: ph.buf.length } });
  await db.student.update({ where: { id: s.id }, data: { avatar: fileUrl(key), avatarSrc: "tg", avatarNotice: auto, tgPhotoChecked: true } });
  return true;
}
