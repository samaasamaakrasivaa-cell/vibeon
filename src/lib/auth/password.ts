import bcrypt from "bcryptjs";

export const MIN_PASSWORD = 8;
export const hashPassword = (p: string) => bcrypt.hash(p, 12);
export const verifyPassword = (p: string, hash: string) => bcrypt.compare(p, hash);
