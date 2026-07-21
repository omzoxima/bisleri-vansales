import { round2, splitInclusiveTax, TaxRates } from './tax';
import { toTotalPcs } from './uom';
import { JAR_VALUE_INR } from '../shared';

/** Minimal item shape the pricing engine needs (masters synced to the device). */
export interface PricedItem {
  itemId: string;
  pcsPerCase: number;
  unitPrice: number; // tax-inclusive price per pc from the price list
  isTwoWay: boolean; // jar / returnable product
  tax: TaxRates;
}

export interface CartLineInput {
  itemId: string;
  qtyCases: number;
  qtyPcs: number;
  emptyJarsReceived: number;
  /** From discount_lines for this customer+item; absolute INR per pc. */
  discountPerPc?: number;
}

export interface SchemeRule {
  schemeHeaderId: string;
  buyItemId: string;
  minQtyPcs: number;
  freeItemId: string;
  freeQtyPcs: number;
}

export interface ComputedLine {
  itemId: string;
  qtyCases: number;
  qtyPcs: number;
  qtyTotalPcs: number;
  unitPrice: number;
  discountValue: number;
  schemeFree: boolean;
  emptyJarsReceived: number;
  lineAmount: number; // gross after discount, before jar shortfall
  cgst: number;
  sgst: number;
  cess: number;
  netAmount: number;
}

export interface OrderSummary {
  lines: ComputedLine[];
  grossAmount: number;
  discountAmount: number;
  schemeAmount: number; // value of free goods issued via scheme
  jarShortfallQty: number;
  jarShortfallAmount: number;
  taxableAmount: number;
  cgst: number;
  sgst: number;
  cess: number;
  netAmount: number; // amount payable = lines net + jar shortfall
}

/**
 * Price a cart: discounts, scheme free lines, inclusive-tax split and the
 * empty-jar rule (customer must return as many jars as two-way units bought;
 * shortfall billed at ₹150/jar).
 */
export function computeOrder(
  cart: CartLineInput[],
  items: Map<string, PricedItem>,
  schemes: SchemeRule[] = [],
): OrderSummary {
  const lines: ComputedLine[] = [];
  let gross = 0;
  let discountTotal = 0;
  let schemeTotal = 0;
  let jarShortfallQty = 0;
  let cgst = 0;
  let sgst = 0;
  let cess = 0;
  let taxable = 0;

  const pushLine = (
    item: PricedItem,
    qtyCases: number,
    qtyPcs: number,
    opts: { schemeFree?: boolean; discountPerPc?: number; jarsReceived?: number },
  ) => {
    const totalPcs = toTotalPcs(qtyCases, qtyPcs, item.pcsPerCase);
    if (totalPcs <= 0) return;
    const unitPrice = opts.schemeFree ? 0 : item.unitPrice;
    const discountValue = opts.schemeFree
      ? 0
      : round2((opts.discountPerPc ?? 0) * totalPcs);
    const grossLine = round2(unitPrice * totalPcs - discountValue);
    const split = splitInclusiveTax(Math.max(0, grossLine), item.tax);

    if (opts.schemeFree) schemeTotal = round2(schemeTotal + item.unitPrice * totalPcs);

    if (item.isTwoWay && !opts.schemeFree) {
      jarShortfallQty += Math.max(0, totalPcs - (opts.jarsReceived ?? 0));
    }

    gross = round2(gross + unitPrice * totalPcs);
    discountTotal = round2(discountTotal + discountValue);
    taxable = round2(taxable + split.taxableAmount);
    cgst = round2(cgst + split.cgst);
    sgst = round2(sgst + split.sgst);
    cess = round2(cess + split.cess);

    lines.push({
      itemId: item.itemId,
      qtyCases,
      qtyPcs,
      qtyTotalPcs: totalPcs,
      unitPrice,
      discountValue,
      schemeFree: opts.schemeFree ?? false,
      emptyJarsReceived: opts.jarsReceived ?? 0,
      lineAmount: Math.max(0, grossLine),
      cgst: split.cgst,
      sgst: split.sgst,
      cess: split.cess,
      netAmount: Math.max(0, grossLine),
    });
  };

  for (const entry of cart) {
    const item = items.get(entry.itemId);
    if (!item) throw new Error(`Unknown item ${entry.itemId}`);
    pushLine(item, entry.qtyCases, entry.qtyPcs, {
      discountPerPc: entry.discountPerPc,
      jarsReceived: entry.emptyJarsReceived,
    });
  }

  // Scheme evaluation: buy X pcs of A → get Y pcs of B free (extra line, per the
  // "Same Product Scheme - Add extra line instead of update quantity" decision).
  for (const rule of schemes) {
    const bought = lines
      .filter((l) => l.itemId === rule.buyItemId && !l.schemeFree)
      .reduce((s, l) => s + l.qtyTotalPcs, 0);
    if (bought >= rule.minQtyPcs && rule.minQtyPcs > 0) {
      const multiples = Math.floor(bought / rule.minQtyPcs);
      const freeItem = items.get(rule.freeItemId);
      if (freeItem) {
        pushLine(freeItem, 0, multiples * rule.freeQtyPcs, { schemeFree: true });
      }
    }
  }

  const jarShortfallAmount = round2(jarShortfallQty * JAR_VALUE_INR);
  const linesNet = round2(lines.reduce((s, l) => s + l.netAmount, 0));

  return {
    lines,
    grossAmount: gross,
    discountAmount: discountTotal,
    schemeAmount: schemeTotal,
    jarShortfallQty,
    jarShortfallAmount,
    taxableAmount: taxable,
    cgst,
    sgst,
    cess,
    netAmount: round2(linesNet + jarShortfallAmount),
  };
}
