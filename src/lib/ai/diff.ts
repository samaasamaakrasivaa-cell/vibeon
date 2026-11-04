// Разница между текстом ученика и исправленной версией — по словам (для отметок в тексте).

export type Piece = { t: string; k: "same" | "del" | "add" };

export function wordDiff(a: string, b: string): Piece[] {
  const A = a.split(/(\s+)/).filter((x) => x !== ""), B = b.split(/(\s+)/).filter((x) => x !== "");
  if (A.length * B.length > 4_000_000) return [{ t: a, k: "del" }, { t: " ", k: "same" }, { t: b, k: "add" }];
  const n = A.length, m = B.length;
  const L: Uint16Array[] = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const out: Piece[] = [];
  const push = (t: string, k: Piece["k"]) => { const last = out[out.length - 1]; if (last && last.k === k) last.t += t; else out.push({ t, k }); };
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (A[i] === B[j]) { push(A[i], "same"); i++; j++; }
    else if (L[i + 1][j] >= L[i][j + 1]) { if (/^\s+$/.test(A[i])) push(A[i], "same"); else push(A[i], "del"); i++; }
    else { if (!/^\s+$/.test(B[j])) push(B[j], "add"); j++; }
  }
  while (i < n) { push(A[i], /^\s+$/.test(A[i]) ? "same" : "del"); i++; }
  while (j < m) { if (!/^\s+$/.test(B[j])) push(" " + B[j], "add"); j++; }
  return out;
}
