/**
 * Invoice utilities: offline-safe numbering from a server-allocated block,
 * and amount-in-words (Indian numbering) for print.
 * (Go-live bugs: duplicate invoice numbers; numeric vs words mismatch.)
 */

export interface InvoiceBlock {
  prefix: string; // e.g. "MI" (Mumbai) or "RI" (Pune)
  seqStart: number;
  seqEnd: number;
  lastUsedSeq: number | null;
}

export class InvoiceBlockExhaustedError extends Error {
  constructor() {
    super('Invoice series block exhausted — sync to get a new block.');
    this.name = 'InvoiceBlockExhaustedError';
  }
}

/** Returns the next invoice number and the updated block state. */
export function nextInvoiceNo(block: InvoiceBlock): {
  invoiceNo: string;
  seq: number;
  block: InvoiceBlock;
} {
  const seq = (block.lastUsedSeq ?? block.seqStart - 1) + 1;
  if (seq > block.seqEnd) throw new InvoiceBlockExhaustedError();
  return {
    invoiceNo: `${block.prefix}-${String(seq).padStart(6, '0')}`,
    seq,
    block: { ...block, lastUsedSeq: seq },
  };
}

const ONES = [
  '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
  'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen',
  'Eighteen', 'Nineteen',
];
const TENS = [
  '', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety',
];

function twoDigits(n: number): string {
  if (n < 20) return ONES[n];
  return `${TENS[Math.floor(n / 10)]}${n % 10 ? ' ' + ONES[n % 10] : ''}`;
}

function threeDigits(n: number): string {
  const h = Math.floor(n / 100);
  const rest = n % 100;
  const parts: string[] = [];
  if (h) parts.push(`${ONES[h]} Hundred`);
  if (rest) parts.push(twoDigits(rest));
  return parts.join(' ');
}

/** Indian-system amount in words, e.g. 125788.5 → "Rupees One Lakh Twenty Five Thousand Seven Hundred Eighty Eight and Fifty Paise Only". */
export function amountInWords(amount: number): string {
  const rupees = Math.floor(Math.abs(amount));
  const paise = Math.round((Math.abs(amount) - rupees) * 100);

  const crore = Math.floor(rupees / 10000000);
  const lakh = Math.floor((rupees % 10000000) / 100000);
  const thousand = Math.floor((rupees % 100000) / 1000);
  const rest = rupees % 1000;

  const parts: string[] = [];
  if (crore) parts.push(`${twoDigits(crore)} Crore`);
  if (lakh) parts.push(`${twoDigits(lakh)} Lakh`);
  if (thousand) parts.push(`${twoDigits(thousand)} Thousand`);
  if (rest) parts.push(threeDigits(rest));
  const rupeeWords = parts.length ? parts.join(' ') : 'Zero';

  const paiseWords = paise ? ` and ${twoDigits(paise)} Paise` : '';
  const sign = amount < 0 ? 'Minus ' : '';
  return `${sign}Rupees ${rupeeWords}${paiseWords} Only`;
}
