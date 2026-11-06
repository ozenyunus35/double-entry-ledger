import { LedgerError, accountMap, code, postEntry, signed } from "./ledger";
import type { Currency } from "./money";
import type { Book, Entry, Line } from "./types";

/** The rate in force on a day: the latest one published on or before it. */
export function rateOn(book: Pick<Book, "rates">, currency: Currency, date: string): number | null {
  if (currency === "TRY") return 1;
  let best: { date: string; rate: number } | null = null;
  for (const r of book.rates) if (r.currency === currency && r.date <= date && (!best || r.date > best.date)) best = r;
  return best?.rate ?? null;
}

/** Foreign balance and the base-currency amount it is carried at, per account and currency, up to a date. */
export function fxPositions(book: Pick<Book, "entries">, to: string): Map<string, { account: string; currency: Currency; fx: number; base: number }> {
  const out = new Map<string, { account: string; currency: Currency; fx: number; base: number }>();
  for (const e of book.entries) {
    if (e.status !== "posted" || e.date > to) continue;
    for (const l of e.lines) {
      const cur = l.currency && l.currency !== "TRY" ? l.currency : l.revalues;
      if (!cur || cur === "TRY") continue;
      const key = `${l.account}|${cur}`;
      let p = out.get(key);
      if (!p) out.set(key, (p = { account: l.account, currency: cur, fx: 0, base: 0 }));
      p.base += l.debit - l.credit;
      if (l.currency === cur && l.fx) p.fx += l.debit > 0 ? l.fx : -l.fx;
    }
  }
  return out;
}

/** What one unit of foreign currency in an account is carried at, after the last revaluation. */
export function carryingRate(book: Pick<Book, "entries">, account: string, currency: Currency, date: string): number | null {
  const p = fxPositions(book, date).get(`${account}|${currency}`);
  if (!p || p.fx === 0) return null;
  return p.base / p.fx;
}

export interface RevaluationLine {
  account: string;
  currency: Currency;
  fx: number;
  carried: number;
  target: number;
  rate: number;
  difference: number;
}

/**
 * Month-end revaluation: foreign balances in money accounts (banks, receivables, payables) are restated at
 * the closing rate, and the difference goes to unrealised exchange gains or losses.
 */
export function revaluationPreview(book: Book, date: string): RevaluationLine[] {
  const accounts = accountMap(book);
  const out: RevaluationLine[] = [];
  for (const p of fxPositions(book, date).values()) {
    const a = accounts.get(p.account);
    if (!a?.monetary) continue;
    const rate = rateOn(book, p.currency, date);
    if (!rate) continue;
    const target = Math.round((p.fx / 100) * rate * 100);
    const difference = target - p.base;
    if (difference === 0) continue;
    out.push({ account: p.account, currency: p.currency, fx: p.fx, carried: p.base, target, rate, difference });
  }
  return out.sort((a, b) => a.account.localeCompare(b.account) || a.currency.localeCompare(b.currency));
}

export function revalue(book: Book, date: string, at?: string): { book: Book; entry: Entry | null; lines: RevaluationLine[] } {
  if (book.entries.some((e) => e.status === "posted" && e.source === "revaluation" && e.date === date))
    throw new LedgerError("already-revalued", "Balances were already revalued on {date}.", { date });
  const preview = revaluationPreview(book, date);
  if (!preview.length) return { book, entry: null, lines: [] };
  const gain = code(book, "fx-gain");
  const loss = code(book, "fx-loss");
  const lines: Line[] = [];
  let net = 0;
  for (const r of preview) {
    const d = r.difference;
    lines.push({ account: r.account, debit: d > 0 ? d : 0, credit: d < 0 ? -d : 0, revalues: r.currency, memo: `${r.currency} @ ${r.rate}` });
    net += d;
  }
  if (net > 0) lines.push({ account: gain, debit: 0, credit: net });
  else if (net < 0) lines.push({ account: loss, debit: -net, credit: 0 });
  else return { book, entry: null, lines: preview };
  const res = postEntry(book, { date, memo: "Month-end FX revaluation", lines, source: "revaluation" }, at);
  return { book: { ...res.book, audit: [{ at: at ?? new Date().toISOString(), action: "revalue", target: date, detail: `${preview.length}` }, ...res.book.audit] }, entry: res.entry, lines: preview };
}

/** Sum of a posted entry's lines on one account, debit positive. Used by the tests. */
export const onAccount = (e: Entry, account: string) => e.lines.filter((l) => l.account === account).reduce((a, l) => a + l.debit - l.credit, 0);

export { signed };
