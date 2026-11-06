import { carryingRate } from "./fx";
import { LedgerError, accountMap, code, newId, postEntry, reverseEntry, validDate } from "./ledger";
import { allocate, convert, toMinor, type Currency } from "./money";
import type { Book, Doc, DocLine, Line, Party, Payment } from "./types";

export const VAT_RATES = [20, 10, 1, 0];

export function lineNet(l: DocLine): number {
  return toMinor((l.quantity * l.price) / 100);
}
export const lineVat = (l: DocLine) => toMinor((lineNet(l) * l.vat) / 10000);

export function docTotals(d: Pick<Doc, "lines">) {
  const net = d.lines.reduce((a, l) => a + lineNet(l), 0);
  const vat = d.lines.reduce((a, l) => a + lineVat(l), 0);
  return { net, vat, total: net + vat };
}

export const paid = (d: Pick<Doc, "payments">) => d.payments.reduce((a, p) => a + p.amount, 0);
export const openAmount = (d: Doc) => (d.void ? 0 : docTotals(d).total - paid(d));

export type DocStatus = "paid" | "partial" | "overdue" | "open" | "void";
export function docStatus(d: Doc, today: string): DocStatus {
  if (d.void) return "void";
  const open = openAmount(d);
  if (open <= 0) return "paid";
  if (d.due < today) return "overdue";
  return paid(d) > 0 ? "partial" : "open";
}

export interface DocInput {
  kind: "invoice" | "bill";
  number: string;
  party: string;
  date: string;
  due: string;
  currency: Currency;
  rate: number;
  lines: DocLine[];
  memo?: string;
}

export function validateDoc(book: Book, input: DocInput): { code: string; message: string; vars?: Record<string, string | number> }[] {
  const out: { code: string; message: string; vars?: Record<string, string | number> }[] = [];
  const accounts = accountMap(book);
  if (!input.number.trim()) out.push({ code: "doc-number", message: "The document needs a number." });
  else if (book.docs.some((d) => d.kind === input.kind && d.number.trim().toLowerCase() === input.number.trim().toLowerCase() && !d.void && (input.kind === "invoice" || d.party === input.party)))
    out.push({ code: "doc-duplicate", message: "Number {n} is already used.", vars: { n: input.number } });
  if (!book.parties.find((p) => p.id === input.party)) out.push({ code: "doc-party", message: input.kind === "invoice" ? "Choose a customer." : "Choose a supplier." });
  if (!validDate(input.date)) out.push({ code: "bad-date", message: "The date {date} is not a real calendar day.", vars: { date: input.date || "—" } });
  if (!validDate(input.due)) out.push({ code: "bad-due", message: "The due date is not a real calendar day." });
  else if (input.due < input.date) out.push({ code: "due-before", message: "The due date is before the document date." });
  if (input.currency !== "TRY" && !(input.rate > 0)) out.push({ code: "doc-rate", message: "A {cur} document needs an exchange rate.", vars: { cur: input.currency } });
  if (!input.lines.length) out.push({ code: "doc-lines", message: "Add at least one line." });
  input.lines.forEach((l, i) => {
    const n = i + 1;
    if (!(l.quantity > 0)) out.push({ code: "doc-qty", message: "Line {n}: quantity must be more than zero.", vars: { n } });
    if (!Number.isInteger(l.price) || l.price < 0) out.push({ code: "doc-price", message: "Line {n}: the price must be zero or more, with at most two decimals.", vars: { n } });
    if (!Number.isFinite(l.vat) || l.vat < 0 || l.vat > 100) out.push({ code: "doc-vat", message: "Line {n}: VAT rate must be between 0 and 100.", vars: { n } });
    const a = accounts.get(l.account);
    if (!a || a.header) out.push({ code: "doc-account", message: "Line {n}: choose an account.", vars: { n } });
    else if (input.kind === "invoice" && a.type !== "income") out.push({ code: "doc-account-type", message: "Line {n}: an invoice line goes to an income account.", vars: { n } });
    else if (input.kind === "bill" && a.type !== "expense" && a.type !== "asset") out.push({ code: "doc-account-type", message: "Line {n}: a bill line goes to an expense or asset account.", vars: { n } });
  });
  if (out.length === 0 && docTotals(input).total <= 0) out.push({ code: "doc-zero", message: "The document total is zero." });
  return out;
}

/** Issues an invoice or records a bill, and posts its journal entry. */
export function createDoc(book: Book, input: DocInput, at?: string): { book: Book; doc: Doc } {
  const issues = validateDoc(book, input);
  if (issues.length) throw new LedgerError(issues[0].code, issues[0].message, issues[0].vars);
  const party = book.parties.find((p) => p.id === input.party)!;
  const foreign = input.currency !== "TRY";
  const rate = foreign ? input.rate : 1;
  const { total } = docTotals(input);
  const parts = [...input.lines.map((l) => ({ account: l.account, fx: lineNet(l) })), { account: input.kind === "invoice" ? code(book, "vat-output") : code(book, "vat-input"), fx: docTotals(input).vat }].filter((p) => p.fx !== 0);
  const baseTotal = foreign ? convert(total, rate) : total;
  const baseParts = allocate(baseTotal, parts.map((p) => p.fx));
  const counter = input.kind === "invoice" ? code(book, "receivables") : code(book, "payables");
  const counterLine: Line = { account: counter, debit: 0, credit: 0, party: party.id };
  if (foreign) Object.assign(counterLine, { currency: input.currency, fx: total, rate });
  const lines: Line[] = [];
  if (input.kind === "invoice") {
    lines.push({ ...counterLine, debit: baseTotal });
    parts.forEach((p, i) => lines.push({ account: p.account, debit: 0, credit: baseParts[i] }));
  } else {
    parts.forEach((p, i) => lines.push({ account: p.account, debit: baseParts[i], credit: 0 }));
    lines.push({ ...counterLine, credit: baseTotal });
  }
  const id = newId(input.kind === "invoice" ? "inv" : "bill");
  const memo = `${input.kind === "invoice" ? "Invoice" : "Bill"} ${input.number.trim()} · ${party.name}`;
  const res = postEntry(book, { date: input.date, memo, ref: input.number.trim(), lines, source: input.kind, doc: id }, at);
  const doc: Doc = { id, kind: input.kind, number: input.number.trim(), party: party.id, date: input.date, due: input.due, currency: input.currency, rate, lines: input.lines, entry: res.entry.id, payments: [], memo: input.memo };
  const b = res.book;
  return { book: { ...b, docs: [...b.docs, doc], audit: [{ at: at ?? new Date().toISOString(), action: input.kind, target: memo }, ...b.audit] }, doc };
}

export interface PaymentInput {
  date: string;
  /** In the document currency, minor units. */
  amount: number;
  /** Rate on the payment day; ignored for TRY documents. */
  rate: number;
  /** Bank or cash account the money moved through. */
  account: string;
}

/**
 * Records money received for an invoice or paid for a bill. In a foreign currency the receivable or
 * payable is cleared at the rate it is carried at, and the difference to today's rate is a realised
 * exchange gain or loss.
 */
export function recordPayment(book: Book, docId: string, input: PaymentInput, at?: string): { book: Book; payment: Payment } {
  const doc = book.docs.find((d) => d.id === docId);
  if (!doc) throw new LedgerError("not-found", "That document no longer exists.");
  if (doc.void) throw new LedgerError("doc-void", "This document is void.");
  const open = openAmount(doc);
  if (!Number.isInteger(input.amount) || input.amount <= 0) throw new LedgerError("pay-amount", "Enter an amount above zero.");
  if (input.amount > open) throw new LedgerError("pay-over", "That is more than the {open} still open.", { open: (open / 100).toFixed(2) });
  if (!validDate(input.date)) throw new LedgerError("bad-date", "The date {date} is not a real calendar day.", { date: input.date || "—" });
  if (input.date < doc.date) throw new LedgerError("pay-before", "The payment is dated before the document.");
  const bank = accountMap(book).get(input.account);
  if (!bank || bank.section !== "cash" || bank.header) throw new LedgerError("pay-account", "Choose a bank or cash account.");
  const bankCur = (bank.currency ?? "TRY") as Currency;
  const foreign = doc.currency !== "TRY";
  if (bankCur !== "TRY" && bankCur !== doc.currency) throw new LedgerError("pay-currency", "Pay a {cur} document from a {cur} or TRY account.", { cur: doc.currency });
  const rate = foreign ? input.rate : 1;
  if (!(rate > 0)) throw new LedgerError("doc-rate", "A {cur} document needs an exchange rate.", { cur: doc.currency });

  const counter = doc.kind === "invoice" ? code(book, "receivables") : code(book, "payables");
  const value = foreign ? convert(input.amount, rate) : input.amount;
  let carried = value;
  if (foreign) {
    const r = carryingRate(book, counter, doc.currency, input.date);
    carried = convert(input.amount, r ?? doc.rate);
  }
  const bankLine: Line = { account: bank.code, debit: 0, credit: 0 };
  if (foreign && bankCur === doc.currency) Object.assign(bankLine, { currency: doc.currency, fx: input.amount, rate });
  const counterLine: Line = { account: counter, debit: 0, credit: 0, party: doc.party };
  if (foreign) Object.assign(counterLine, { currency: doc.currency, fx: input.amount, rate: carried / input.amount });
  const lines: Line[] = [];
  const diff = value - carried;
  if (doc.kind === "invoice") {
    lines.push({ ...bankLine, debit: value }, { ...counterLine, credit: carried });
    if (diff > 0) lines.push({ account: code(book, "fx-gain"), debit: 0, credit: diff });
    if (diff < 0) lines.push({ account: code(book, "fx-loss"), debit: -diff, credit: 0 });
  } else {
    lines.push({ ...counterLine, debit: carried }, { ...bankLine, credit: value });
    if (diff > 0) lines.push({ account: code(book, "fx-loss"), debit: diff, credit: 0 });
    if (diff < 0) lines.push({ account: code(book, "fx-gain"), debit: 0, credit: -diff });
  }
  const party = book.parties.find((p) => p.id === doc.party);
  const memo = `${doc.kind === "invoice" ? "Payment received" : "Payment made"} · ${doc.number} · ${party?.name ?? ""}`.trim();
  const res = postEntry(book, { date: input.date, memo, ref: doc.number, lines, source: "payment", doc: doc.id }, at);
  const payment: Payment = { id: newId("pay"), date: input.date, amount: input.amount, rate, account: bank.code, entry: res.entry.id };
  const b = res.book;
  return {
    book: { ...b, docs: b.docs.map((d) => (d.id === doc.id ? { ...d, payments: [...d.payments, payment] } : d)), audit: [{ at: at ?? new Date().toISOString(), action: "payment", target: memo }, ...b.audit] },
    payment,
  };
}

/** Voids a document with no payments by reversing its entry. */
export function voidDoc(book: Book, docId: string, date: string, at?: string): Book {
  const doc = book.docs.find((d) => d.id === docId);
  if (!doc) throw new LedgerError("not-found", "That document no longer exists.");
  if (doc.void) throw new LedgerError("doc-void", "This document is void.");
  if (doc.payments.length) throw new LedgerError("doc-paid", "Payments were recorded against this document. Reverse them first.");
  const res = reverseEntry(book, doc.entry, date < doc.date ? doc.date : date, at);
  return { ...res.book, docs: res.book.docs.map((d) => (d.id === doc.id ? { ...d, void: true } : d)) };
}

export interface AgingRow {
  doc: Doc;
  party: Party | undefined;
  open: number;
  /** Open amount in base currency at the as-of rate. */
  base: number;
  days: number;
  bucket: 0 | 1 | 2 | 3 | 4;
}

export const BUCKETS = ["Current", "1–30 days", "31–60 days", "61–90 days", "Over 90 days"] as const;

export function aging(book: Book, kind: "invoice" | "bill", asOf: string, rateFor: (c: Currency) => number): AgingRow[] {
  const out: AgingRow[] = [];
  for (const doc of book.docs) {
    if (doc.kind !== kind || doc.void || doc.date > asOf) continue;
    const paidBy = doc.payments.filter((p) => p.date <= asOf).reduce((a, p) => a + p.amount, 0);
    const open = docTotals(doc).total - paidBy;
    if (open <= 0) continue;
    const days = Math.round((Date.parse(asOf) - Date.parse(doc.due)) / 86_400_000);
    const bucket = days <= 0 ? 0 : days <= 30 ? 1 : days <= 60 ? 2 : days <= 90 ? 3 : 4;
    const base = doc.currency === "TRY" ? open : convert(open, rateFor(doc.currency));
    out.push({ doc, party: book.parties.find((p) => p.id === doc.party), open, base, days, bucket });
  }
  return out.sort((a, b) => b.days - a.days);
}
