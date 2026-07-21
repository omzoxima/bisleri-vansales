/**
 * UOM conversion — the ONE place cases/pcs math lives.
 * (In the Power Apps build this was re-written per screen and diverged:
 *  "1 case + 2 pcs showed 5 cases 9 pcs in backend".)
 */

export function toTotalPcs(qtyCases: number, qtyPcs: number, pcsPerCase: number): number {
  if (pcsPerCase <= 0) throw new Error('pcsPerCase must be > 0');
  return qtyCases * pcsPerCase + qtyPcs;
}

export function toCasesAndPcs(
  totalPcs: number,
  pcsPerCase: number,
): { cases: number; pcs: number } {
  if (pcsPerCase <= 0) throw new Error('pcsPerCase must be > 0');
  const safe = Math.max(0, Math.floor(totalPcs));
  return { cases: Math.floor(safe / pcsPerCase), pcs: safe % pcsPerCase };
}

export function formatCasesPcs(totalPcs: number, pcsPerCase: number): string {
  const { cases, pcs } = toCasesAndPcs(totalPcs, pcsPerCase);
  if (cases && pcs) return `${cases}c ${pcs}p`;
  if (cases) return `${cases}c`;
  return `${pcs}p`;
}
