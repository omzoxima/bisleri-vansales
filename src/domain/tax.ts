/**
 * GST math. Selling prices are TAX-INCLUSIVE (UAT finding TC-003:
 * "Taxes are included in the selling price, apply the back calculation method").
 *
 * 12% items split 6+6 (e.g. 20 L jar), 18% items split 9+9.
 */

export interface TaxRates {
  cgstRate: number; // e.g. 6 for 6%
  sgstRate: number;
  cessRate?: number;
}

export interface TaxSplit {
  taxableAmount: number;
  cgst: number;
  sgst: number;
  cess: number;
  grossAmount: number;
}

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Back-calculate the tax split from a tax-inclusive amount. */
export function splitInclusiveTax(grossAmount: number, rates: TaxRates): TaxSplit {
  const totalRate = rates.cgstRate + rates.sgstRate + (rates.cessRate ?? 0);
  const taxable = grossAmount / (1 + totalRate / 100);
  const cgst = (taxable * rates.cgstRate) / 100;
  const sgst = (taxable * rates.sgstRate) / 100;
  const cess = (taxable * (rates.cessRate ?? 0)) / 100;
  return {
    taxableAmount: round2(taxable),
    cgst: round2(cgst),
    sgst: round2(sgst),
    cess: round2(cess),
    grossAmount: round2(grossAmount),
  };
}
