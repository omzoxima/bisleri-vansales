/**
 * FIFO batch allocation by mfg date + batch no + lot no.
 * (Go-live issue: "gate pass logic was working for mfg day only; changed to
 *  mfg date + batch no. + lot no.")
 */

export interface BatchStock {
  batchId: string;
  mfgDate: string; // ISO date
  batchNo: string;
  lotNo: string;
  availablePcs: number;
}

export interface BatchAllocation {
  batchId: string;
  qtyPcs: number;
}

export class InsufficientStockError extends Error {
  constructor(
    public readonly requested: number,
    public readonly available: number,
  ) {
    super(`Requested ${requested} pcs but only ${available} available`);
    this.name = 'InsufficientStockError';
  }
}

/** Allocate `qtyPcs` across batches oldest-first. Throws if stock is short. */
export function allocateFifo(qtyPcs: number, batches: BatchStock[]): BatchAllocation[] {
  const ordered = [...batches]
    .filter((b) => b.availablePcs > 0)
    .sort(
      (a, b) =>
        a.mfgDate.localeCompare(b.mfgDate) ||
        a.batchNo.localeCompare(b.batchNo) ||
        a.lotNo.localeCompare(b.lotNo),
    );

  const totalAvailable = ordered.reduce((s, b) => s + b.availablePcs, 0);
  if (qtyPcs > totalAvailable) throw new InsufficientStockError(qtyPcs, totalAvailable);

  const allocations: BatchAllocation[] = [];
  let remaining = qtyPcs;
  for (const batch of ordered) {
    if (remaining <= 0) break;
    const take = Math.min(batch.availablePcs, remaining);
    allocations.push({ batchId: batch.batchId, qtyPcs: take });
    remaining -= take;
  }
  return allocations;
}
