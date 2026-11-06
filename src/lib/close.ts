import { LedgerError, accountMap, balances, code, monthEnd, natural, postEntry, validDate } from "./ledger";
import type { Book, Entry, Line } from "./types";

export interface VatReport {
  month: string;
  output: number;
  input: number;
  carriedIn: number;
  /** Positive: to pay this month; zero when input VAT is carried forward instead. */
  payable: number;
  carriedOut: number;
  settled: Entry | null;
  /** Sales and purchases with the VAT on them, for the declaration. */
  sales: { rate: number; net: number; vat: number }[];
  purchases: { rate: number; net: number; vat: number }[];
}

/** The month's VAT: what was charged on sales against what was paid on purchases, plus last month's carry-forward. */
export function vatReport(book: Book, month: string): VatReport {
  const from = `${month}-01`;
  const to = monthEnd(month);
  const outCode = code(book, "vat-output");
  const inCode = code(book, "vat-input");
  const carryCode = code(book, "vat-carried");
  const accounts = accountMap(book);
  const period = balances(book, { from, to, exclude: (e) => e.source === "vat" });
  const output = natural(accounts.get(outCode)!, period.get(outCode));
  const input = natural(accounts.get(inCode)!, period.get(inCode));
  const before = balances(book, { to: to, exclude: (e) => e.source === "vat" && e.date >= from });
  const carriedIn = natural(accounts.get(carryCode)!, before.get(carryCode));
  const net = output - input - carriedIn;
  const settled = book.entries.find((e) => e.status === "posted" && e.source === "vat" && e.date === to && !e.reversedBy) ?? null;

  const bucket = (kind: "invoice" | "bill") => {
    const by = new Map<number, { rate: number; net: number; vat: number }>();
    for (const d of book.docs) {
      if (d.kind !== kind || d.void || d.date < from || d.date > to) continue;
      for (const l of d.lines) {
        const r = by.get(l.vat) ?? { rate: l.vat, net: 0, vat: 0 };
        const rate = d.currency === "TRY" ? 1 : d.rate;
        const n = Math.round(l.quantity * l.price * rate);
        r.net += n;
        r.vat += Math.round((n * l.vat) / 100);
        by.set(l.vat, r);
      }
    }
    return [...by.values()].sort((a, b) => b.rate - a.rate);
  };
  return { month, output, input, carriedIn, payable: Math.max(0, net), carriedOut: Math.max(0, -net), settled, sales: bucket("invoice"), purchases: bucket("bill") };
}

/**
 * Closes the month's VAT accounts: output VAT against input VAT and the carry-forward, leaving either
 * VAT to pay (in taxes payable) or a new carry-forward.
 */
export function settleVat(book: Book, month: string, at?: string): { book: Book; entry: Entry | null } {
  const r = vatReport(book, month);
  if (r.settled) throw new LedgerError("vat-settled", "VAT for {month} is already settled.", { month });
  const to = monthEnd(month);
  const lines: Line[] = [];
  const push = (role: Parameters<typeof code>[1], amount: number) => {
    if (amount > 0) lines.push({ account: code(book, role), debit: amount, credit: 0 });
    if (amount < 0) lines.push({ account: code(book, role), debit: 0, credit: -amount });
  };
  push("vat-output", r.output);
  push("vat-input", -r.input);
  if (r.payable > 0) {
    push("vat-carried", -r.carriedIn);
    push("taxes-payable", -r.payable);
  } else {
    push("vat-carried", r.carriedOut - r.carriedIn);
  }
  if (!lines.length) return { book, entry: null };
  const res = postEntry(book, { date: to, memo: `VAT settlement ${month}`, lines, source: "vat" }, at);
  return { book: { ...res.book, audit: [{ at: at ?? new Date().toISOString(), action: "vat", target: month }, ...res.book.audit] }, entry: res.entry };
}

/** Income and expense balances of a year, before its closing entry. */
export function yearResult(book: Book, year: number): { lines: { account: string; amount: number }[]; result: number } {
  const accounts = accountMap(book);
  const b = balances(book, { from: `${year}-01-01`, to: `${year}-12-31`, exclude: (e) => e.source === "closing" });
  const lines: { account: string; amount: number }[] = [];
  let result = 0;
  for (const [acc, bal] of b) {
    const a = accounts.get(acc);
    if (!a || (a.type !== "income" && a.type !== "expense")) continue;
    const s = bal.debit - bal.credit;
    if (s === 0) continue;
    lines.push({ account: acc, amount: s });
    result -= s;
  }
  return { lines: lines.sort((x, y) => x.account.localeCompare(y.account, "en", { numeric: true })), result };
}

/**
 * Year-end close: every income and expense account goes to zero against the year's result, the result is
 * carried to retained earnings (or accumulated losses) on the first day of the next year, and the year is locked.
 */
export function closeYear(book: Book, year: number, at?: string): { book: Book; closing: Entry | null; carry: Entry | null } {
  if (!Number.isInteger(year)) throw new LedgerError("bad-year", "Choose a year.");
  if (book.closedYears.includes(year)) throw new LedgerError("year-closed-already", "{year} is already closed.", { year });
  const earliest = book.entries.filter((e) => e.status === "posted").reduce((m, e) => (e.date < m ? e.date : m), "9999");
  const firstYear = Number(earliest.slice(0, 4));
  if (year > firstYear && !book.closedYears.includes(year - 1) && book.entries.some((e) => e.status === "posted" && e.date.startsWith(String(year - 1)) && e.source !== "opening"))
    throw new LedgerError("close-in-order", "Close {year} first.", { year: year - 1 });
  const end = `${year}-12-31`;
  if (!validDate(end)) throw new LedgerError("bad-year", "Choose a year.");
  const drafts = book.entries.filter((e) => e.status === "draft" && e.date <= end);
  if (drafts.length) throw new LedgerError("drafts-in-period", "{n} draft entries are dated in this period. Post or delete them first.", { n: drafts.length });
  const { lines: pl, result } = yearResult(book, year);
  const lock = book.lockedThrough;
  // The closing entries are dated inside the period being locked, so they post with the lock lifted.
  let b: Book = { ...book, lockedThrough: lock && lock >= end ? `${year}-12-30` : lock };
  let closing: Entry | null = null;
  let carry: Entry | null = null;
  if (pl.length) {
    const lines: Line[] = pl.map((l) => ({ account: l.account, debit: l.amount < 0 ? -l.amount : 0, credit: l.amount > 0 ? l.amount : 0 }));
    if (result > 0) lines.push({ account: code(b, "current-result"), debit: 0, credit: result });
    if (result < 0) lines.push({ account: code(b, "current-loss"), debit: -result, credit: 0 });
    const res = postEntry(b, { date: end, memo: `Closing entry ${year}`, lines, source: "closing" }, at);
    b = res.book;
    closing = res.entry;
    if (result !== 0) {
      const next = `${year + 1}-01-01`;
      const carryLines: Line[] =
        result > 0
          ? [
              { account: code(b, "current-result"), debit: result, credit: 0 },
              { account: code(b, "retained-earnings"), debit: 0, credit: result },
            ]
          : [
              { account: code(b, "accumulated-losses"), debit: -result, credit: 0 },
              { account: code(b, "current-loss"), debit: 0, credit: -result },
            ];
      const c = postEntry({ ...b, lockedThrough: lock && lock >= next ? `${year}-12-31` : b.lockedThrough }, { date: next, memo: `${year} result to ${result > 0 ? "retained earnings" : "accumulated losses"}`, lines: carryLines, source: "closing" }, at);
      b = c.book;
      carry = c.entry;
    }
  }
  const newLock = !lock || lock < end ? end : lock;
  b = { ...b, lockedThrough: newLock, closedYears: [...b.closedYears, year].sort(), audit: [{ at: at ?? new Date().toISOString(), action: "close-year", target: String(year), detail: String(result) }, ...b.audit] };
  return { book: b, closing, carry };
}
