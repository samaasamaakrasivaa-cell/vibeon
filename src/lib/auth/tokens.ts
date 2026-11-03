import "server-only";
import type { AuthTokenType } from "@prisma/client";
import { db } from "../db";
import { randomToken, sha256 } from "./crypto";

const TTL: Record<AuthTokenType, number> = {
  VERIFY_EMAIL: 24 * 3600 * 1000,
  MAGIC_LINK: 15 * 60 * 1000,
  RESET_PASSWORD: 3600 * 1000,
};

export async function issueToken(userId: string, type: AuthTokenType) {
  const token = randomToken();
  await db.authToken.create({ data: { userId, type, tokenHash: sha256(token), expiresAt: new Date(Date.now() + TTL[type]) } });
  return token;
}

/**
 * Проверяет токен из письма. Ссылки подтверждения и входа можно открыть повторно, пока они действуют:
 * почтовые сервисы иногда сами «открывают» ссылки для проверки, и одноразовая ссылка сгорела бы до клика.
 * Сброс пароля — строго одноразовый.
 */
export async function useToken(token: string, type: AuthTokenType) {
  if (!token) return null;
  const t = await db.authToken.findUnique({ where: { tokenHash: sha256(token) } });
  if (!t || t.type !== type || t.expiresAt < new Date()) return null;
  if (type === "RESET_PASSWORD" && t.usedAt) return null;
  if (!t.usedAt) await db.authToken.update({ where: { id: t.id }, data: { usedAt: new Date() } });
  return t;
}
