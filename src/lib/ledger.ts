import { debitNormal, roleCode, type Account, type Role } from "./charts";
import { convert, type Currency } from "./money";
import type { AuditEvent, Book, Entry, EntrySource, Line } from "./types";

/** A rule the books refuse to break. The code is stable (tests and the UI use it); the text is shown. */
export class LedgerError extends Error {
  constructor(
    public code: string,
    message: string,
    public vars: Record<string, string | number> = {},
  ) {
    super(message);
  }
}

export interface Issue {
  code: string;
  message: string;
  vars?: Record<string, string | number>;
  line?: number;
}

/** The largest amount one line may carry: 10 billion in base currency. */
export const MAX_MINOR = 1_000_000_000_000;

export const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function validDate(s: string): boolean {
  const m = ISO_DATE.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (y < 1900 || y > 2200 || mo < 1 || mo > 12 || d < 1) return false;
  return d <= new Date(Date.UTC(y, mo, 0)).getUTCDate();
}

export const sum = (lines: Line[], side: "debit" | "credit") => lines.reduce((a, l) => a + l[side], 0);

export function accountMap(book: Pick<Book, "accounts">): Map<string, Account> {
  return new Map(book.accounts.map((a) => [a.code, a]));
}

export const code = (book: Pick<Book, "accounts">, role: Role) => roleCode(book.accounts, role);

/** Everything wrong with an entry before it may be posted. An empty list means it balances and fits the books. */
export function validateEntry(book: Pick<Book, "accounts" | "lockedThrough">, entry: Pick<Entry, "date" | "lines">): Issue[] {
  const issues: Issue[] = [];
  const accounts = accountMap(book);
  if (!validDate(entry.date)) issues.push({ code: "bad-date", message: "The date {date} is not a real calendar day.", vars: { date: entry.date || "—" } });
  else if (book.lockedThrough && entry.date <= book.lockedThrough)
    issues.push({ code: "locked", message: "The period through {date} is locked. Date the entry later, or unlock the period.", vars: { date: book.lockedThrough } });
  const lines = entry.lines;
  if (lines.length < 2) issues.push({ code: "too-few-lines", message: "An entry needs at least two lines: something debited and something credited." });
  lines.forEach((l, i) => {
    const n = i + 1;
    const a = accounts.get(l.account);
    if (!l.account) issues.push({ code: "no-account", message: "Line {n} has no account.", vars: { n }, line: i });
    else if (!a) issues.push({ code: "unknown-account", message: "Line {n}: there is no account {code} in this chart.", vars: { n, code: l.account }, line: i });
    else if (a.header) issues.push({ code: "header-account", message: "Line {n}: {code} is a heading; post to one of its sub-accounts.", vars: { n, code: l.account }, line: i });
    else if (a.archived) issues.push({ code: "archived-account", message: "Line {n}: account {code} is archived.", vars: { n, code: l.account }, line: i });
    for (const side of ["debit", "credit"] as const) {
      const v = l[side];
      if (!Number.isInteger(v)) issues.push({ code: "not-integer", message: "Line {n}: the amount has more than two decimals.", vars: { n }, line: i });
      else if (v < 0) issues.push({ code: "negative", message: "Line {n}: amounts can't be negative; put the amount on the other side.", vars: { n }, line: i });
      else if (v > MAX_MINOR) issues.push({ code: "too-large", message: "Line {n}: the amount is larger than this ledger accepts.", vars: { n }, line: i });
    }
    if (l.debit > 0 && l.credit > 0) issues.push({ code: "both-sides", message: "Line {n} has both a debit and a credit; split it into two lines.", vars: { n }, line: i });
    if (l.debit === 0 && l.credit === 0) issues.push({ code: "zero-line", message: "Line {n} has no amount.", vars: { n }, line: i });
    if (l.currency && l.currency !== "TRY") {
      if (!l.rate || !(l.rate > 0) || !l.fx || !(l.fx > 0)) issues.push({ code: "fx-incomplete", message: "Line {n} is in {cur}: it needs the foreign amount and the rate.", vars: { n, cur: l.currency }, line: i });
      else if (Math.abs(convert(l.fx, l.rate) - (l.debit || l.credit)) > 1)
        issues.push({ code: "fx-mismatch", message: "Line {n}: {cur} amount × rate doesn't match the TRY amount.", vars: { n, cur: l.currency }, line: i });
    }
  });
  const d = sum(lines, "debit");
  const c = sum(lines, "credit");
  if (lines.length >= 2 && d !== c)
    issues.push({ code: "unbalanced", message: "Debits and credits differ by {diff}. An entry must balance to the kuruş.", vars: { diff: (Math.abs(d - c) / 100).toFixed(2) } });
  return issues;
}

export const now = () => new Date().toISOString();

let counter = 0;
/** Set while demo books are generated, so their ids are the same on every rebuild and links to them keep working. */
let sequence: { n: number } | null = null;

export function newId(prefix: string): string {
  if (sequence) return `${prefix}-${(++sequence.n).toString(36)}`;
  counter = (counter + 1) % 1e6;
  return `${prefix}-${Date.now().toString(36)}${counter.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/** Runs a function with numbered ids instead of random ones. */
export function withSequentialIds<T>(fn: () => T): T {
  const prev = sequence;
  sequence = { n: 0 };
  try {
    return fn();
  } finally {
    sequence = prev;
  }
}

function audit(book: Book, action: AuditEvent["action"], target: string, detail?: string, at = now()): Book {
  return { ...book, audit: [{ at, action, target, detail }, ...book.audit].slice(0, 2000) };
}

export function entryLabel(e: Pick<Entry, "no" | "memo">): string {
  return e.no ? `#${e.no} ${e.memo}` : e.memo;
}

/** Cleans what a form produced: trims, drops empty rows, rounds nothing (amounts are already minor units). */
export function cleanLines(lines: Line[]): Line[] {
  return lines
    .filter((l) => l.account || l.debit || l.credit)
    .map((l) => {
      const out: Line = { account: l.account.trim(), debit: l.debit || 0, credit: l.credit || 0 };
      if (l.currency && l.currency !== "TRY") {
        out.currency = l.currency;
        out.fx = l.fx;
        out.rate = l.rate;
      }
      if (l.revalues && l.revalues !== "TRY") out.revalues = l.revalues;
      if (l.party) out.party = l.party;
      if (l.memo?.trim()) out.memo = l.memo.trim();
      return out;
    });
}

export interface EntryInput {
  date: string;
  memo: string;
  ref?: string;
  lines: Line[];
  source?: EntrySource;
  doc?: string;
}

/** Saves an entry as a draft. Drafts may be unbalanced; posting is where the rules apply. */
export function saveDraft(book: Book, input: EntryInput, id?: string, at = now()): { book: Book; entry: Entry } {
  if (id) {
    const old = book.entries.find((e) => e.id === id);
    if (!old) throw new LedgerError("not-found", "That entry no longer exists.");
    if (old.status !== "draft") throw new LedgerError("posted-immutable", "Posted entries can't be edited. Reverse it and post a corrected entry.");
    const entry: Entry = { ...old, date: input.date, memo: input.memo.trim(), ref: input.ref?.trim() || undefined, lines: cleanLines(input.lines) };
    const next = { ...book, entries: book.entries.map((e) => (e.id === id ? entry : e)) };
    return { book: audit(next, "edit", entry.memo || "draft"), entry };
  }
  const entry: Entry = {
    id: newId("e"),
    no: null,
    date: input.date,
    memo: input.memo.trim(),
    ref: input.ref?.trim() || undefined,
    status: "draft",
    source: input.source ?? "manual",
    lines: cleanLines(input.lines),
    doc: input.doc,
    createdAt: at,
  };
  // Entries posted straight away (invoices, payments, imports) log one event, not a draft and a post.
  const next = { ...book, entries: [...book.entries, entry] };
  return { book: input.source && input.source !== "manual" ? next : audit(next, "create", entry.memo || "draft", undefined, at), entry };
}

export function deleteDraft(book: Book, id: string): Book {
  const e = book.entries.find((x) => x.id === id);
  if (!e) throw new LedgerError("not-found", "That entry no longer exists.");
  if (e.status !== "draft") throw new LedgerError("posted-immutable", "Posted entries can't be deleted. Reverse it instead.");
  return audit({ ...book, entries: book.entries.filter((x) => x.id !== id) }, "delete", e.memo || "draft");
}

/** Posts a draft: checks every rule, gives it the next journal number, and freezes it. */
export function postDraft(book: Book, id: string, at = now()): { book: Book; entry: Entry } {
  const e = book.entries.find((x) => x.id === id);
  if (!e) throw new LedgerError("not-found", "That entry no longer exists.");
  if (e.status === "posted") throw new LedgerError("already-posted", "This entry is already posted.");
  const issues = validateEntry(book, e);
  if (issues.length) throw new LedgerError(issues[0].code, issues[0].message, issues[0].vars);
  const entry: Entry = { ...e, status: "posted", no: book.nextNo, postedAt: at };
  const next = { ...book, nextNo: book.nextNo + 1, entries: book.entries.map((x) => (x.id === id ? entry : x)) };
  return { book: audit(next, "post", entryLabel(entry), undefined, at), entry };
}

/** Creates and posts in one step; used by invoices, payments and the automatic entries. */
export function postEntry(book: Book, input: EntryInput, at = now()): { book: Book; entry: Entry } {
  const issues = validateEntry(book, { date: input.date, lines: cleanLines(input.lines) });
  if (issues.length) throw new LedgerError(issues[0].code, issues[0].message, issues[0].vars);
  const draft = saveDraft(book, input, undefined, at);
  return postDraft(draft.book, draft.entry.id, at);
}

/** Corrects a posted entry the only way a ledger allows: a mirror entry with debits and credits swapped. */
export function reverseEntry(book: Book, id: string, date: string, at = now()): { book: Book; entry: Entry } {
  const e = book.entries.find((x) => x.id === id);
  if (!e) throw new LedgerError("not-found", "That entry no longer exists.");
  if (e.status !== "posted") throw new LedgerError("not-posted", "Only posted entries can be reversed; delete a draft instead.");
  if (e.reversedBy) throw new LedgerError("already-reversed", "This entry was already reversed.");
  if (e.reverses) throw new LedgerError("is-reversal", "This entry is itself a reversal; post a new entry instead.");
  if (date < e.date) throw new LedgerError("reversal-before", "A reversal can't be dated before the entry it reverses.");
  const lines = e.lines.map((l) => ({ ...l, debit: l.credit, credit: l.debit }));
  const posted = postEntry(book, { date, memo: `Reversal of #${e.no}: ${e.memo}`, ref: e.ref, lines, source: "reversal", doc: e.doc }, at);
  const reversal = { ...posted.entry, reverses: e.id };
  const next = {
    ...posted.book,
    entries: posted.book.entries.map((x) => (x.id === e.id ? { ...x, reversedBy: reversal.id } : x.id === reversal.id ? reversal : x)),
  };
  return { book: audit(next, "reverse", entryLabel(e), `#${reversal.no}`, at), entry: reversal };
}

export function lockThrough(book: Book, date: string): Book {
  if (!validDate(date)) throw new LedgerError("bad-date", "The date {date} is not a real calendar day.", { date });
  const drafts = book.entries.filter((e) => e.status === "draft" && e.date <= date);
  if (drafts.length) throw new LedgerError("drafts-in-period", "{n} draft entries are dated in this period. Post or delete them first.", { n: drafts.length });
  return audit({ ...book, lockedThrough: date }, "lock", date);
}

export function unlock(book: Book, date: string | null): Book {
  if (date && book.lockedThrough && date > book.lockedThrough) throw new LedgerError("unlock-later", "Unlocking can only move the lock date earlier.");
  const closed = Math.max(0, ...book.closedYears);
  if (closed && (!date || date < `${closed}-12-31`))
    throw new LedgerError("year-closed", "{year} is closed. Its closing entries keep the books consistent, so the lock can't move before its end.", { year: closed });
  return audit({ ...book, lockedThrough: date }, "unlock", date ?? "—");
}

export interface Balance {
  debit: number;
  credit: number;
  /** Foreign currency balances, debit positive. */
  fx: Partial<Record<Currency, number>>;
}

export const signed = (b: Balance) => b.debit - b.credit;

/** Debit and credit totals per account over posted entries, inside an optional date range (inclusive). */
export function balances(book: Pick<Book, "entries">, opts: { from?: string; to?: string; exclude?: (e: Entry) => boolean } = {}): Map<string, Balance> {
  const out = new Map<string, Balance>();
  for (const e of book.entries) {
    if (e.status !== "posted") continue;
    if (opts.from && e.date < opts.from) continue;
    if (opts.to && e.date > opts.to) continue;
    if (opts.exclude?.(e)) continue;
    for (const l of e.lines) {
      let b = out.get(l.account);
      if (!b) out.set(l.account, (b = { debit: 0, credit: 0, fx: {} }));
      b.debit += l.debit;
      b.credit += l.credit;
      if (l.currency && l.fx) b.fx[l.currency] = (b.fx[l.currency] ?? 0) + (l.debit > 0 ? l.fx : -l.fx);
    }
  }
  return out;
}

/** The balance in the account's natural direction: a bank with money in it is positive, so is a payable that is owed. */
export function natural(account: Account, b: Balance | undefined): number {
  if (!b) return 0;
  return debitNormal(account) ? b.debit - b.credit : b.credit - b.debit;
}

/** Postable accounts sorted by code, headers included for display. */
export function sortedAccounts(book: Pick<Book, "accounts">): Account[] {
  return [...book.accounts].sort((a, b) => a.code.localeCompare(b.code, "en", { numeric: true }));
}

export const posted = (book: Pick<Book, "entries">) => book.entries.filter((e) => e.status === "posted");

/** The day before a date, both ISO. */
export function dayBefore(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

export function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function monthEnd(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

export function addMonths(ym: string, n: number): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}
