// Оплата отдельного урока: в каком он состоянии и можно ли подтвердить оплату прямо у урока.
// Счёт создаётся сам по правилам из анкеты, но подтвердить оплату проведённого урока учитель может всегда — даже без счёта.

export type PayState = "paid" | "billed" | "pack" | "unpaid";
type L = { id: string; status: string; charged: boolean; isTrial: boolean; price: number | null; deductedAt: Date | null };
type I = { id: string; status: string; lessonIds: string[]; proofKind?: string | null };

/** Урок, за который платят: проведён (или оплачиваемый пропуск); бесплатный пробный — нет. */
export const payable = (l: Pick<L, "status" | "charged" | "isTrial" | "price">) =>
  (l.status === "DONE" || (l.status === "MISSED" && l.charged)) && (!l.isTrial || (l.price ?? 0) > 0);

/** Состояние оплаты урока; null — платить не нужно (будущий, отменённый, бесплатный пробный). quick — оплату отметил учитель у урока. */
export function payStateOf(l: L, invoices: I[]): { state: PayState; invId: string | null; quick: boolean } | null {
  if (!payable(l)) return null;
  const inv = invoices.filter((i) => i.status !== "CANCELLED" && i.lessonIds.includes(l.id)).sort((a, b) => (a.status === "PAID" ? -1 : 0) - (b.status === "PAID" ? -1 : 0))[0];
  if (inv?.status === "PAID") return { state: "paid", invId: inv.id, quick: inv.proofKind === "teacher" };
  if (inv) return { state: "billed", invId: inv.id, quick: false };
  if (l.deductedAt) return { state: "pack", invId: null, quick: false };
  return { state: "unpaid", invId: null, quick: false };
}
