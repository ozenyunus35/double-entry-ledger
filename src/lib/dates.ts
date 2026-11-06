import { validDate } from "./ledger";

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, oca: 1, ocak: 1,
  feb: 2, february: 2, sub: 2, şub: 2, subat: 2, şubat: 2,
  mar: 3, march: 3, mart: 3,
  apr: 4, april: 4, nis: 4, nisan: 4,
  may: 5, mayıs: 5, mayis: 5,
  jun: 6, june: 6, haz: 6, haziran: 6,
  jul: 7, july: 7, tem: 7, temmuz: 7,
  aug: 8, august: 8, ağu: 8, agu: 8, ağustos: 8, agustos: 8,
  sep: 9, sept: 9, september: 9, eyl: 9, eylül: 9, eylul: 9,
  oct: 10, october: 10, eki: 10, ekim: 10,
  nov: 11, november: 11, kas: 11, kasım: 11, kasim: 11,
  dec: 12, december: 12, ara: 12, aralık: 12, aralik: 12,
};

const pad = (n: number) => String(n).padStart(2, "0");

function make(y: number, m: number, d: number): string | null {
  if (y < 100) y += y < 70 ? 2000 : 1900;
  const s = `${y}-${pad(m)}-${pad(d)}`;
  return validDate(s) ? s : null;
}

export type DateOrder = "dmy" | "mdy";

/**
 * Reads the dates people put in spreadsheets and bank exports: 2026-01-31, 31.01.2026, 31/01/26,
 * 01/31/2026 (when the order says so), 31 Oca 2026, Jan 31, 2026, and Excel serial numbers.
 */
export function parseDate(input: string | number | null | undefined, order: DateOrder = "dmy"): string | null {
  if (input === null || input === undefined) return null;
  if (typeof input === "number") return fromSerial(input);
  const s = input.normalize("NFKC").trim().toLocaleLowerCase("tr").replace(/\s+/g, " ");
  if (!s) return null;
  let m = /^(\d{4})[-./](\d{1,2})[-./](\d{1,2})(?:[ t]\d{1,2}:\d{2}(?::\d{2})?.*)?$/.exec(s);
  if (m) return make(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})[-./](\d{1,2})[-./](\d{2}|\d{4})(?: \d{1,2}:\d{2}(?::\d{2})?)?$/.exec(s);
  if (m) {
    const a = +m[1];
    const b = +m[2];
    if (a > 12) return make(+m[3], b, a);
    if (b > 12) return make(+m[3], a, b);
    return order === "mdy" ? make(+m[3], a, b) : make(+m[3], b, a);
  }
  m = /^(\d{1,2})[ .-]?([a-zçğıöşü]+)\.?[ .-]?(\d{2}|\d{4})$/.exec(s);
  if (m && MONTHS[m[2]]) return make(+m[3], MONTHS[m[2]], +m[1]);
  m = /^([a-zçğıöşü]+)\.? (\d{1,2}),? (\d{4})$/.exec(s);
  if (m && MONTHS[m[1]]) return make(+m[3], MONTHS[m[1]], +m[2]);
  if (/^\d{5}(\.\d+)?$/.test(s)) return fromSerial(Number(s));
  return null;
}

/** Excel stores dates as days since 30 Dec 1899. */
export function fromSerial(n: number): string | null {
  if (!Number.isFinite(n) || n < 20000 || n > 80000) return null;
  const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(n) * 86_400_000);
  return d.toISOString().slice(0, 10);
}

/** Looks at a column of dates and says whether ambiguous ones (03/04/2026) are day-first or month-first. */
export function detectOrder(values: string[]): DateOrder {
  let dmy = 0;
  let mdy = 0;
  for (const v of values) {
    const m = /^(\d{1,2})[-./](\d{1,2})[-./]\d{2,4}/.exec(v.trim());
    if (!m) continue;
    if (+m[1] > 12) dmy++;
    else if (+m[2] > 12) mdy++;
  }
  return mdy > dmy ? "mdy" : "dmy";
}
