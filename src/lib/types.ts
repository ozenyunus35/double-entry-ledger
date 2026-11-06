import type { Account, ChartId } from "./charts";
import type { Currency } from "./money";

/** One side of a journal entry. Amounts are base-currency minor units; exactly one of debit/credit is non-zero. */
export interface Line {
  account: string;
  debit: number;
  credit: number;
  /** Set when the line was booked in a foreign currency. */
  currency?: Currency;
  /** Foreign amount in minor units, always positive; its side follows debit/credit. */
  fx?: number;
  /** Base currency per one unit of the foreign currency. */
  rate?: number;
  /** A base-currency-only adjustment to the foreign balance of this currency (month-end revaluation, rounding). */
  revalues?: Currency;
  /** Customer or supplier the line belongs to. */
  party?: string;
  memo?: string;
}

export type EntryStatus = "draft" | "posted";
export type EntrySource =
  | "manual"
  | "opening"
  | "invoice"
  | "bill"
  | "payment"
  | "payroll"
  | "depreciation"
  | "revaluation"
  | "vat"
  | "closing"
  | "import"
  | "recurring"
  | "reversal";

export interface Entry {
  id: string;
  /** Journal number, given when the entry is posted; drafts have none. */
  no: number | null;
  date: string;
  memo: string;
  ref?: string;
  status: EntryStatus;
  source: EntrySource;
  lines: Line[];
  /** The entry this one reverses, and the entry that reversed this one. */
  reverses?: string;
  reversedBy?: string;
  /** Invoice or bill that produced the entry. */
  doc?: string;
  createdAt: string;
  postedAt?: string;
}

export interface Party {
  id: string;
  name: string;
  kind: "customer" | "supplier";
  country: string;
  currency: Currency;
  taxId?: string;
  email?: string;
  /** Days to pay. */
  terms: number;
}

export interface DocLine {
  description: string;
  quantity: number;
  /** Unit price in the document currency, minor units. */
  price: number;
  /** VAT rate in percent: 20, 10, 1 or 0 (export of services is exempt). */
  vat: number;
  /** Income account for invoices, expense or asset account for bills. */
  account: string;
}

export interface Payment {
  id: string;
  date: string;
  /** Amount in the document currency, minor units. */
  amount: number;
  rate: number;
  account: string;
  entry: string;
}

/** A sales invoice or a supplier bill. */
export interface Doc {
  id: string;
  kind: "invoice" | "bill";
  number: string;
  party: string;
  date: string;
  due: string;
  currency: Currency;
  rate: number;
  lines: DocLine[];
  entry: string;
  payments: Payment[];
  memo?: string;
  void?: boolean;
}

export interface Rate {
  date: string;
  currency: Currency;
  /** Base currency per one unit. */
  rate: number;
}

export interface Recurring {
  id: string;
  name: string;
  /** Day of month the entry is dated. */
  day: number;
  /** First month the template runs, YYYY-MM. */
  start: string;
  /** Last month it ran, YYYY-MM. */
  last: string | null;
  memo: string;
  lines: Line[];
  active: boolean;
}

export interface AuditEvent {
  at: string;
  action: "create" | "edit" | "post" | "delete" | "reverse" | "lock" | "unlock" | "close-year" | "revalue" | "import" | "invoice" | "bill" | "payment" | "vat" | "recurring" | "account" | "reset";
  /** What the event was about, as shown in the log. */
  target: string;
  detail?: string;
}

export interface Book {
  id: string;
  name: string;
  legalName: string;
  taxId: string;
  city: string;
  chart: ChartId;
  base: Currency;
  accounts: Account[];
  entries: Entry[];
  parties: Party[];
  docs: Doc[];
  rates: Rate[];
  recurring: Recurring[];
  /** Nothing dated on or before this day can be posted, edited or reversed into. */
  lockedThrough: string | null;
  closedYears: number[];
  audit: AuditEvent[];
  nextNo: number;
  /** Synthetic demo books are rebuilt around today; user books are not. */
  demo: boolean;
  createdAt: string;
}
