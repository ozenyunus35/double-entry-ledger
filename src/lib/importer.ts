import type { Account, Role } from "./charts";
import { detectOrder, parseDate, type DateOrder } from "./dates";
import { openAmount } from "./docs";
import { accountMap, cleanLines, code, newId, postEntry, validateEntry, type Issue } from "./ledger";
import { CURRENCIES, detectDecimal, parseAmount, type Currency, type DecimalMark } from "./money";
import type { Book, Entry, Line } from "./types";

/** Text from a file's bytes: UTF-8 when it decodes cleanly, otherwise the Turkish Windows code page Excel uses. */
export function decodeBytes(bytes: Uint8Array): string {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    text = new TextDecoder("windows-1254").decode(bytes);
  }
  return text.replace(/^﻿/, "");
}

/** An exchange rate as typed: "50,1234" or "50.1234"; four decimals are kept. */
export function parseRate(s: string): number {
  const t = s.trim().replace(/\s/g, "");
  if (!t) return NaN;
  const n = Number(t.includes(",") && !t.includes(".") ? t.replace(",", ".") : t.replace(/,/g, ""));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 10000) / 10000 : NaN;
}

/** Splits CSV text into rows, with quoted fields, doubled quotes, CRLF, and the delimiter detected. */
export function parseCsv(text: string): { rows: string[][]; delimiter: string } {
  const sample = text.split(/\r?\n/).filter((l) => l.trim()).slice(0, 20);
  const candidates = [",", ";", "\t", "|"];
  let delimiter = ",";
  let best = -1;
  for (const d of candidates) {
    const counts = sample.map((l) => countOutsideQuotes(l, d));
    const first = counts[0] ?? 0;
    if (!first) continue;
    const consistent = counts.filter((c) => c === first).length;
    const score = consistent * 10 + first;
    if (score > best) {
      best = score;
      delimiter = d;
    }
  }
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"' && field.trim() === "") {
      quoted = true;
      field = "";
    } else if (ch === delimiter) {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return { rows: rows.map((r) => r.map((c) => c.trim())).filter((r) => r.some((c) => c !== "")), delimiter };
}

function countOutsideQuotes(line: string, d: string): number {
  let n = 0;
  let q = false;
  for (const ch of line) {
    if (ch === '"') q = !q;
    else if (ch === d && !q) n++;
  }
  return n;
}

const fold = (s: string) => s.toLocaleLowerCase("tr").normalize("NFD").replace(/\p{M}/gu, "").replace(/ı/g, "i").replace(/[^a-z0-9]+/g, " ").trim();

export type JournalField = "date" | "entry" | "account" | "description" | "debit" | "credit" | "amount" | "currency" | "fx" | "rate" | "ref";

const HEADER_WORDS: Record<JournalField, string[]> = {
  date: ["date", "tarih", "posting date", "islem tarihi", "fis tarihi", "valor", "datum"],
  entry: ["entry", "entry no", "journal", "journal no", "voucher", "fis", "fis no", "yevmiye no", "yevmiye", "transaction id", "je", "je no"],
  account: ["account", "account code", "hesap", "hesap kodu", "hesap no", "gl account", "konto"],
  description: ["description", "aciklama", "memo", "narration", "text", "detay", "explanation"],
  debit: ["debit", "borc", "dr", "debit amount", "soll"],
  credit: ["credit", "alacak", "cr", "credit amount", "haben"],
  amount: ["amount", "tutar", "signed amount", "betrag", "net"],
  currency: ["currency", "doviz", "para birimi", "cur", "ccy", "doviz cinsi"],
  fx: ["fx amount", "doviz tutari", "foreign amount", "amount fx", "dovizli tutar"],
  rate: ["rate", "kur", "exchange rate", "fx rate", "doviz kuru"],
  ref: ["ref", "reference", "referans", "belge no", "document", "doc no", "evrak no"],
};

/** Guesses which column holds what from the header row, in English or Turkish. */
export function guessJournalColumns(header: string[]): Partial<Record<JournalField, number>> {
  const out: Partial<Record<JournalField, number>> = {};
  const used = new Set<number>();
  const h = header.map(fold);
  for (const exact of [true, false]) {
    for (const field of Object.keys(HEADER_WORDS) as JournalField[]) {
      if (out[field] !== undefined) continue;
      const i = h.findIndex((x, idx) => !used.has(idx) && HEADER_WORDS[field].some((w) => (exact ? x === w : x.startsWith(w + " ") || x.endsWith(" " + w))));
      if (i >= 0) {
        out[field] = i;
        used.add(i);
      }
    }
  }
  return out;
}

/** Finds an account from what a file wrote: "102.01", "10201", "102 01", or its name in either language. */
export function matchAccount(accounts: Account[], raw: string): Account | null {
  const s = raw.trim();
  if (!s) return null;
  const byCode = accounts.find((a) => a.code === s);
  if (byCode) return byCode;
  const digits = s.replace(/[^\d]/g, "");
  if (digits && /^[\d .\-/]+$/.test(s)) {
    const found = accounts.find((a) => a.code.replace(/\D/g, "") === digits);
    if (found) return found;
  }
  // "102.01 Bankalar TRY" or "1010 - Bank TRY": a code at the start followed by a name.
  const lead = /^([\d.]+)\s*[-–:]?\s+\S/.exec(s);
  if (lead) {
    const found = accounts.find((a) => a.code === lead[1] || a.code.replace(/\D/g, "") === lead[1].replace(/\D/g, ""));
    if (found) return found;
  }
  const f = fold(s);
  return accounts.find((a) => fold(a.name.en) === f || fold(a.name.tr) === f) ?? null;
}

export interface ImportedEntry {
  key: string;
  rows: number[];
  date: string | null;
  memo: string;
  ref?: string;
  lines: Line[];
  issues: Issue[];
}

export interface JournalImport {
  entries: ImportedEntry[];
  /** Problems with the file as a whole, such as a missing column. */
  fileIssues: Issue[];
  decimal: DecimalMark | null;
  order: DateOrder;
  rowsRead: number;
}

/**
 * Reads journal lines from a table and groups them into entries: by an entry number column when the file
 * has one, otherwise by running until debits equal credits. Every entry is checked by the ledger's own rules;
 * nothing is posted until the user confirms.
 */
export function readJournal(book: Book, rows: string[][], columns?: Partial<Record<JournalField, number>>): JournalImport {
  const fileIssues: Issue[] = [];
  if (rows.length < 2) return { entries: [], fileIssues: [{ code: "empty-file", message: "The file has no rows under its header." }], decimal: null, order: "dmy", rowsRead: 0 };
  const header = rows[0];
  const col = columns ?? guessJournalColumns(header);
  const body = rows.slice(1);
  if (col.date === undefined) fileIssues.push({ code: "no-date-column", message: "No date column was found. Name it Date or Tarih." });
  if (col.account === undefined) fileIssues.push({ code: "no-account-column", message: "No account column was found. Name it Account or Hesap." });
  if (col.amount === undefined && (col.debit === undefined || col.credit === undefined))
    fileIssues.push({ code: "no-amount-columns", message: "Amounts need Debit and Credit columns (Borç, Alacak) or one signed Amount column." });
  if (fileIssues.length) return { entries: [], fileIssues, decimal: null, order: "dmy", rowsRead: body.length };

  const get = (r: string[], f: JournalField) => (col[f] === undefined ? "" : (r[col[f]!] ?? "").trim());
  const amountCells = body.flatMap((r) => [get(r, "debit"), get(r, "credit"), get(r, "amount"), get(r, "fx")]).filter(Boolean);
  const decimal = detectDecimal(amountCells);
  const order = detectOrder(body.map((r) => get(r, "date")));
  const accounts = book.accounts;

  type Row = { index: number; key: string; date: string | null; rawDate: string; line: Line | null; memo: string; ref: string; issues: Issue[] };
  const parsed: Row[] = body.map((r, i) => {
    const index = i + 2;
    const issues: Issue[] = [];
    const rawDate = get(r, "date");
    const date = parseDate(rawDate, order);
    if (!date) issues.push({ code: "row-date", message: "Row {row}: can't read the date {value}.", vars: { row: index, value: rawDate || "—" } });
    const accRaw = get(r, "account");
    const acc = matchAccount(accounts, accRaw);
    if (!acc) issues.push({ code: "row-account", message: "Row {row}: no account matches {value}.", vars: { row: index, value: accRaw || "—" } });
    else if (acc.header) issues.push({ code: "row-header", message: "Row {row}: {value} is a heading; use one of its sub-accounts.", vars: { row: index, value: acc.code } });
    let debit = 0;
    let credit = 0;
    const read = (f: JournalField) => {
      const v = get(r, f);
      if (!v) return 0;
      const n = parseAmount(v, decimal ?? undefined);
      if (n === null) {
        issues.push({ code: "row-amount", message: "Row {row}: {value} is not an amount.", vars: { row: index, value: v } });
        return 0;
      }
      return n;
    };
    if (col.debit !== undefined || col.credit !== undefined) {
      debit = read("debit");
      credit = read("credit");
      if (debit < 0 && credit === 0) [debit, credit] = [0, -debit];
      if (credit < 0 && debit === 0) [debit, credit] = [-credit, 0];
    }
    if (!debit && !credit && col.amount !== undefined) {
      const a = read("amount");
      if (a > 0) debit = a;
      else credit = -a;
    }
    if (debit && credit) {
      const net = debit - credit;
      debit = Math.max(net, 0);
      credit = Math.max(-net, 0);
    }
    if (!debit && !credit && !issues.some((x) => x.code === "row-amount")) issues.push({ code: "row-zero", message: "Row {row} has no amount.", vars: { row: index } });
    let line: Line | null = acc ? { account: acc.code, debit, credit } : null;
    const curRaw = get(r, "currency").toUpperCase().replace("TL", "TRY");
    if (line && curRaw && curRaw !== "TRY") {
      if (!(CURRENCIES as string[]).includes(curRaw)) issues.push({ code: "row-currency", message: "Row {row}: unknown currency {value}.", vars: { row: index, value: curRaw } });
      else {
        const fx = read("fx");
        const rate = parseRate(get(r, "rate"));
        if (fx && rate > 0) line = { ...line, currency: curRaw as Currency, fx: Math.abs(fx), rate };
        else issues.push({ code: "row-fx", message: "Row {row}: a {value} line needs the foreign amount and the rate.", vars: { row: index, value: curRaw } });
      }
    }
    const memo = get(r, "description");
    if (line && memo) line = { ...line, memo };
    return { index, key: get(r, "entry"), date, rawDate, line, memo, ref: get(r, "ref"), issues };
  });

  const groups: Row[][] = [];
  if (col.entry !== undefined) {
    const by = new Map<string, Row[]>();
    for (const r of parsed) {
      const k = r.key || `row-${r.index}`;
      if (!by.has(k)) by.set(k, []);
      by.get(k)!.push(r);
    }
    groups.push(...by.values());
  } else {
    let cur: Row[] = [];
    let bal = 0;
    for (const r of parsed) {
      cur.push(r);
      bal += (r.line?.debit ?? 0) - (r.line?.credit ?? 0);
      if (bal === 0 && cur.length >= 2) {
        groups.push(cur);
        cur = [];
      }
    }
    if (cur.length) groups.push(cur);
  }

  const entries: ImportedEntry[] = groups.map((g, gi) => {
    const issues: Issue[] = g.flatMap((r) => r.issues);
    const dates = [...new Set(g.map((r) => r.date).filter(Boolean))] as string[];
    if (dates.length > 1) issues.push({ code: "mixed-dates", message: "Rows {rows} share an entry but have different dates.", vars: { rows: g.map((r) => r.index).join(", ") } });
    const lines = g.map((r) => r.line).filter((l): l is Line => !!l);
    const date = dates[0] ?? null;
    if (date && !issues.length) {
      for (const i of validateEntry(book, { date, lines: cleanLines(lines) })) issues.push({ ...i, message: i.message, vars: i.vars });
    }
    const memo = g.find((r) => r.memo)?.memo ?? "";
    return { key: g[0].key || `#${gi + 1}`, rows: g.map((r) => r.index), date, memo, ref: g.find((r) => r.ref)?.ref || g[0].key || undefined, lines, issues };
  });
  return { entries, fileIssues, decimal, order, rowsRead: body.length };
}

/** Posts the entries that passed every check. Entries with problems are left out and reported. */
export function postImport(book: Book, imp: JournalImport, at?: string): { book: Book; posted: Entry[] } {
  let b = book;
  const posted: Entry[] = [];
  for (const e of imp.entries) {
    if (e.issues.length || !e.date) continue;
    const res = postEntry(b, { date: e.date, memo: e.memo || `Imported entry ${e.key}`, ref: e.ref, lines: e.lines, source: "import" }, at);
    b = res.book;
    posted.push(res.entry);
  }
  return { book: { ...b, audit: [{ at: at ?? new Date().toISOString(), action: "import", target: `${posted.length} entries` }, ...b.audit] }, posted };
}

export interface BankRow {
  row: number;
  date: string | null;
  description: string;
  /** Money in positive, money out negative, minor units. */
  amount: number;
  suggestion: Role | null;
  account: string | null;
  /** An open invoice or bill this row pays exactly. */
  doc?: string;
  duplicate: boolean;
  issues: Issue[];
}

/** Description words, matched as word stems so Turkish suffixes still match ("faizi", "kirası"). Fees come first: "EFT ücreti" is a fee, not wages. */
const RULES: [RegExp, Role][] = [
  [/\b(komisyon|masraf|fee|charge|eft ucret|havale ucret|swift)/, "bank-fees"],
  [/\b(kira|rent)/, "rent"],
  [/\b(maas|salar|payroll|personel ucret|wage)/, "salaries-payable"],
  [/\b(sgk|sosyal guvenlik|social security)/, "social-security-payable"],
  [/\b(kdv|vat\b|vergi|tax\b|muhtasar|gecici vergi)/, "taxes-payable"],
  [/\b(faiz|interest)/, "interest-income"],
];

export const BANK_FIELDS = ["date", "description", "amount", "in", "out", "balance"] as const;
type BankField = (typeof BANK_FIELDS)[number];
const BANK_WORDS: Record<BankField, string[]> = {
  date: ["date", "tarih", "islem tarihi", "valor", "booking date", "value date"],
  description: ["description", "aciklama", "details", "islem aciklamasi", "narrative", "memo"],
  amount: ["amount", "tutar", "islem tutari"],
  in: ["in", "credit", "deposit", "alacak", "gelen", "money in", "paid in"],
  out: ["out", "debit", "withdrawal", "borc", "giden", "money out", "paid out"],
  balance: ["balance", "bakiye", "running balance"],
};

/**
 * Reads a bank statement export and suggests the other side of each line: an open invoice or bill it pays
 * exactly, or an account from the words in the description. Rows already imported are flagged.
 */
export function readBank(book: Book, bankAccount: string, rows: string[][]): { rows: BankRow[]; fileIssues: Issue[] } {
  if (rows.length < 2) return { rows: [], fileIssues: [{ code: "empty-file", message: "The file has no rows under its header." }] };
  const h = rows[0].map(fold);
  const col: Partial<Record<BankField, number>> = {};
  for (const f of BANK_FIELDS) {
    const i = h.findIndex((x, idx) => !Object.values(col).includes(idx) && BANK_WORDS[f].includes(x));
    if (i >= 0) col[f] = i;
  }
  const fileIssues: Issue[] = [];
  if (col.date === undefined) fileIssues.push({ code: "no-date-column", message: "No date column was found. Name it Date or Tarih." });
  if (col.amount === undefined && col.in === undefined && col.out === undefined) fileIssues.push({ code: "no-bank-amount", message: "No amount column was found (Amount / Tutar, or In and Out)." });
  if (fileIssues.length) return { rows: [], fileIssues };
  const body = rows.slice(1);
  const get = (r: string[], f: BankField) => (col[f] === undefined ? "" : (r[col[f]!] ?? "").trim());
  const decimal = detectDecimal(body.flatMap((r) => [get(r, "amount"), get(r, "in"), get(r, "out")]).filter(Boolean));
  const order = detectOrder(body.map((r) => get(r, "date")));
  const accounts = accountMap(book);
  const bank = accounts.get(bankAccount);
  const seen = new Set(book.entries.filter((e) => e.source === "import" && e.ref?.startsWith("BANK:")).map((e) => e.ref));
  const out: BankRow[] = body.map((r, i) => {
    const row = i + 2;
    const issues: Issue[] = [];
    const date = parseDate(get(r, "date"), order);
    if (!date) issues.push({ code: "row-date", message: "Row {row}: can't read the date {value}.", vars: { row, value: get(r, "date") || "—" } });
    let amount = 0;
    if (col.amount !== undefined) amount = parseAmount(get(r, "amount"), decimal ?? undefined) ?? NaN;
    else {
      const inn = get(r, "in") ? parseAmount(get(r, "in"), decimal ?? undefined) : 0;
      const outt = get(r, "out") ? parseAmount(get(r, "out"), decimal ?? undefined) : 0;
      amount = inn === null || outt === null ? NaN : Math.abs(inn) - Math.abs(outt);
    }
    if (!Number.isFinite(amount)) issues.push({ code: "row-amount", message: "Row {row}: the amount can't be read.", vars: { row } });
    else if (amount === 0) issues.push({ code: "row-zero", message: "Row {row} has no amount.", vars: { row } });
    const description = get(r, "description");
    const f = fold(description);
    let suggestion: Role | null = null;
    let doc: string | undefined;
    if (Number.isFinite(amount) && amount !== 0 && bank && (bank.currency ?? "TRY") === "TRY") {
      const kind = amount > 0 ? "invoice" : "bill";
      const matches = book.docs.filter((d) => {
        if (d.kind !== kind || d.void || d.currency !== "TRY") return false;
        return openAmount(d) === Math.abs(amount);
      });
      const named = matches.find((d) => f.includes(fold(book.parties.find((p) => p.id === d.party)?.name ?? "").split(" ")[0] ?? "") || f.includes(fold(d.number)));
      const pick = named ?? (matches.length === 1 ? matches[0] : undefined);
      if (pick) {
        doc = pick.id;
        suggestion = kind === "invoice" ? "receivables" : "payables";
      }
    }
    if (!suggestion) for (const [re, role] of RULES) if (re.test(f)) {
      suggestion = role;
      break;
    }
    const ref = `BANK:${bankAccount}:${date}:${amount}:${f.slice(0, 40)}`;
    let account: string | null = null;
    try {
      account = suggestion ? code(book, suggestion) : null;
    } catch {
      account = null;
    }
    return { row, date, description, amount, suggestion, account, doc, duplicate: seen.has(ref), issues };
  });
  return { rows: out, fileIssues };
}

export const bankRef = (bankAccount: string, r: Pick<BankRow, "date" | "amount" | "description">) => `BANK:${bankAccount}:${r.date}:${r.amount}:${fold(r.description).slice(0, 40)}`;

/** Two-line entries for the bank rows the user accepted. Invoice and bill matches are booked as payments by the caller. */
export function bankEntries(bankAccount: string, rows: BankRow[]): { date: string; memo: string; ref: string; lines: Line[] }[] {
  return rows
    .filter((r) => r.date && r.account && !r.doc && !r.duplicate && !r.issues.length)
    .map((r) => {
      const amt = Math.abs(r.amount);
      const bankLine: Line = { account: bankAccount, debit: r.amount > 0 ? amt : 0, credit: r.amount < 0 ? amt : 0 };
      const other: Line = { account: r.account!, debit: r.amount < 0 ? amt : 0, credit: r.amount > 0 ? amt : 0 };
      return { date: r.date!, memo: r.description || "Bank transaction", ref: bankRef(bankAccount, r), lines: [bankLine, other] };
    });
}

export const sampleJournalCsv = (book: Book) => {
  const c = (role: Role) => code(book, role);
  return [
    "Entry;Date;Account;Description;Debit;Credit",
    `J-1;03.11.2026;${c("office")};Printer paper and toner;1.250,00;`,
    `J-1;03.11.2026;${c("vat-input")};VAT 20%;250,00;`,
    `J-1;03.11.2026;${c("cash")};Paid in cash;;1.500,00`,
    `J-2;04.11.2026;${c("bank-try")};Refund from supplier;3.600,00;`,
    `J-2;04.11.2026;${c("payables")};Overpayment returned;;3.600,00`,
  ].join("\n");
};

export { newId };
