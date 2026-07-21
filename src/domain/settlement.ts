import { round2 } from './tax';
import { JAR_VALUE_INR, SettlementLedger } from '../shared';

/**
 * The four-ledger settlement engine (blueprint §3.3).
 * The day cannot end until every ledger is inside tolerance.
 */

export interface SettlementInputs {
  // Cash ledger
  invoicedTotal: number;
  creditTotal: number;
  digitalTotal: number; // paytm / cheque / coupon collections
  cashDeposited: number;
  // Stock ledger (pcs)
  loadedPcs: number;
  soldPcs: number;
  focPcs: number;
  transferInPcs: number;
  transferOutPcs: number;
  replacementInPcs: number;
  stockReturnedPcs: number;
  // Jar ledger
  twoWayUnitsSold: number;
  jarsCollected: number;
  jarShortfallBilledQty: number; // shortfall already billed at ₹150
  jarsPhysicalCount: number;
  // FOC ledger
  focNormAmount: number;
  focActualAmount: number;
}

export interface LedgerResult {
  ledger: SettlementLedger;
  expected: number;
  actual: number;
  variance: number; // actual - expected
  withinTolerance: boolean;
}

export interface SettlementResult {
  ledgers: LedgerResult[];
  balanced: boolean;
}

export interface SettlementTolerances {
  cashInr: number;
  stockPcs: number;
  jars: number;
  focInr: number;
}

export const DEFAULT_TOLERANCES: SettlementTolerances = {
  cashInr: 20, // "a ₹20 rounding gap is noise"
  stockPcs: 0,
  jars: 0,
  focInr: 0,
};

export function computeSettlement(
  input: SettlementInputs,
  tol: SettlementTolerances = DEFAULT_TOLERANCES,
): SettlementResult {
  const cashExpected = round2(
    input.invoicedTotal - input.creditTotal - input.digitalTotal,
  );
  const stockExpected =
    input.loadedPcs +
    input.transferInPcs +
    input.replacementInPcs -
    input.soldPcs -
    input.focPcs -
    input.transferOutPcs;
  const jarsExpected = Math.max(
    0,
    input.twoWayUnitsSold - input.jarShortfallBilledQty,
  );

  const ledgers: LedgerResult[] = [
    mk('cash', cashExpected, input.cashDeposited, tol.cashInr),
    mk('stock', stockExpected, input.stockReturnedPcs, tol.stockPcs),
    mk('jars', jarsExpected, input.jarsPhysicalCount, tol.jars),
    mk('foc', input.focNormAmount, input.focActualAmount, tol.focInr, true),
  ];

  return { ledgers, balanced: ledgers.every((l) => l.withinTolerance) };
}

function mk(
  ledger: SettlementLedger,
  expected: number,
  actual: number,
  tolerance: number,
  overOnly = false, // FOC: only over-norm is a problem
): LedgerResult {
  const variance = round2(actual - expected);
  const withinTolerance = overOnly
    ? variance <= tolerance
    : Math.abs(variance) <= tolerance;
  return { ledger, expected: round2(expected), actual: round2(actual), variance, withinTolerance };
}

/** INR value recoverable from a jar shortfall at settlement. */
export function jarRecoveryValue(shortfallQty: number): number {
  return round2(Math.max(0, shortfallQty) * JAR_VALUE_INR);
}
