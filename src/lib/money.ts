/**
 * Money is kept as integer minor units (kuruş, cents) so that sums are exact.
 * A ledger that is off by 0.01 because of floating point is a broken ledger.
 */

export type Currency = "TRY" | "EUR" | "USD" | "GBP";
export const CURRENCIES: Currency[] = ["TRY", "EUR", "USD", "GBP"];

/** 12.345 → 1235 (rounds half away from zero, the way an accountant rounds). */
export function toMinor(n: number): number {
  if (!Number.isFinite(n)) return NaN;
  const s = Math.sign(n);
  return s * Math.round(Math.abs(n) * 100 + 1e-7);
}

export const fromMinor = (m: number) => m / 100;

/** Foreign amount (minor) × rate → base amount (minor), rounded once. */
export const convert = (fxMinor: number, rate: number) => toMinor((fxMinor / 100) * rate);

/** Splits a total into parts that sum exactly to it, giving the leftover kuruş to the first parts. */
export function allocate(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum === 0) return weights.map(() => 0);
  const raw = weights.map((w) => (total * w) / sum);
  const out = raw.map((r) => Math.trunc(r));
  let left = total - out.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => ({ i, frac: Math.abs(r - Math.trunc(r)) })).sort((a, b) => b.frac - a.frac);
  for (let k = 0; left !== 0 && k < order.length * 2; k++) {
    const i = order[k % order.length].i;
    out[i] += Math.sign(left);
    left -= Math.sign(left);
  }
  return out;
}

export type DecimalMark = "," | ".";

/**
 * Reads an amount the way people type it in English or Turkish files:
 * "1,234.56", "1.234,56", "1 234,56", "₺1.234", "(500.00)", "-12,5", "1.234,56-", "12,50 TL".
 * Returns minor units, or null when the text is not a number.
 * When the decimal mark is unknown and the text is ambiguous ("1.234"), a single separator
 * followed by exactly three digits is read as a thousands separator.
 */
export function parseAmount(input: string | number | null | undefined, decimal?: DecimalMark): number | null {
  if (input === null || input === undefined) return null;
  if (typeof input === "number") return Number.isFinite(input) ? toMinor(input) : null;
  let s = input.normalize("NFKC").trim();
  if (!s) return null;
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  s = s.replace(/^(?:TRY|TL|EUR|USD|GBP|[₺€$£])\s*/i, "").replace(/\s*(?:TRY|TL|EUR|USD|GBP|[₺€$£])$/i, "");
  if (/^[-−–]/.test(s)) {
    negative = !negative;
    s = s.slice(1);
  } else if (/[-−–]$/.test(s)) {
    negative = !negative;
    s = s.slice(0, -1);
  }
  s = s.replace(/^(?:TRY|TL|EUR|USD|GBP|[₺€$£])\s*/i, "").replace(/[\s'’  ]/g, "");
  if (!/^\d[\d.,]*$/.test(s) && !/^[.,]\d+$/.test(s)) return null;
  const dots = (s.match(/\./g) ?? []).length;
  const commas = (s.match(/,/g) ?? []).length;
  let mark: DecimalMark | null = null;
  if (dots && commas) mark = s.lastIndexOf(",") > s.lastIndexOf(".") ? "," : ".";
  else if (dots > 1) mark = ",";
  else if (commas > 1) mark = ".";
  else if (dots === 1 || commas === 1) {
    const sep = dots ? "." : ",";
    const after = s.length - s.indexOf(sep) - 1;
    if (decimal) mark = decimal;
    else mark = after === 3 && s.indexOf(sep) > 0 ? (sep === "." ? "," : ".") : (sep as DecimalMark);
  }
  let normal = s;
  if (mark === ",") normal = s.replace(/\./g, "").replace(",", ".");
  else if (mark === ".") normal = s.replace(/,/g, "");
  if ((normal.match(/\./g) ?? []).length > 1) return null;
  // Thousands groups must be three digits long; "1.23.4" is not a number.
  if (mark) {
    const thousands = mark === "," ? "." : ",";
    const intPart = s.split(mark)[0];
    if (intPart.includes(thousands) && !intPart.split(thousands).slice(1).every((g) => g.length === 3)) return null;
  }
  const n = Number(normal);
  if (!Number.isFinite(n)) return null;
  const decimals = normal.includes(".") ? normal.split(".")[1].length : 0;
  if (decimals > 4) return null;
  const minor = toMinor(n);
  return negative ? -minor : minor;
}

/** Looks at many values from one file and says which decimal mark it uses, or null when nothing tells. */
export function detectDecimal(values: string[]): DecimalMark | null {
  let comma = 0;
  let dot = 0;
  for (const raw of values) {
    const s = raw.replace(/[^\d.,]/g, "");
    if (!s) continue;
    const lc = s.lastIndexOf(",");
    const ld = s.lastIndexOf(".");
    if (lc > -1 && ld > -1) {
      if (lc > ld) comma++;
      else dot++;
    }
    else if (lc > -1 && s.length - lc - 1 !== 3) comma++;
    else if (ld > -1 && s.length - ld - 1 !== 3) dot++;
    else if (/^\d{1,3}(\.\d{3}){2,}$/.test(s)) comma++;
    else if (/^\d{1,3}(,\d{3}){2,}$/.test(s)) dot++;
  }
  if (comma === dot) return null;
  return comma > dot ? "," : ".";
}
