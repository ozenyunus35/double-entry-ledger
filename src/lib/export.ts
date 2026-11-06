import { aging, BUCKETS, docTotals } from "./docs";
import { uiLang } from "./format";
import { rateOn } from "./fx";
import { translateKnown } from "./i18n";
import { accountMap, sortedAccounts } from "./ledger";
import { balanceSheet, cashFlow, incomeStatement, trialBalance, type StatementLine } from "./reports";
import type { Book } from "./types";

/** Headers and labels follow the interface language; account names too. Entry text stays as written. */
const tx = (s: string) => translateKnown(uiLang(), s);
const name = (a: { name: { en: string; tr: string } }) => a.name[uiLang()];

type Cell = string | number | null;
type Sheet = { name: string; header: string[]; rows: Cell[][]; money: number[]; bold?: number[]; widths?: number[] };

const m = (minor: number) => minor / 100;

export function journalRows(book: Book, from: string, to: string): Cell[][] {
  const acc = accountMap(book);
  return book.entries
    .filter((e) => e.status === "posted" && e.date >= from && e.date <= to)
    .sort((a, b) => a.date.localeCompare(b.date) || (a.no ?? 0) - (b.no ?? 0))
    .flatMap((e) =>
      e.lines.map((l) => [e.no, e.date, e.memo, e.ref ?? "", l.account, acc.get(l.account) ? name(acc.get(l.account)!) : "", l.debit ? m(l.debit) : null, l.credit ? m(l.credit) : null, l.currency ?? "", l.fx ? m(l.fx) : null, l.rate ?? null, tx(SOURCE[e.source] ?? e.source)]),
    );
}

export const SOURCE: Record<string, string> = {
  manual: "Manual",
  opening: "Opening",
  invoice: "Invoice",
  bill: "Bill",
  payment: "Payment",
  payroll: "Payroll",
  depreciation: "Depreciation",
  revaluation: "FX revaluation",
  vat: "VAT",
  closing: "Closing",
  import: "Import",
  recurring: "Recurring",
  reversal: "Reversal",
};

export const JOURNAL_HEADER = ["Entry", "Date", "Description", "Reference", "Account", "Account name", "Debit", "Credit", "Currency", "Foreign amount", "Rate", "Source"];

function statementRows(lines: StatementLine[]): { rows: Cell[][]; bold: number[] } {
  const rows: Cell[][] = [];
  const bold: number[] = [];
  for (const l of lines) {
    if (l.total) bold.push(rows.length);
    rows.push([tx(l.label), "", m(l.amount)]);
    for (const a of l.accounts ?? []) rows.push([`    ${a.account.code}`, name(a.account), m(a.amount)]);
  }
  return { rows, bold };
}

const csvCell = (v: Cell) => {
  if (v === null) return "";
  const s = String(v);
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function journalCsv(book: Book, from: string, to: string): string {
  return [JOURNAL_HEADER.map(tx), ...journalRows(book, from, to)].map((r) => r.map(csvCell).join(",")).join("\n") + "\n";
}

/** One workbook with the journal, trial balance, statements, ledger accounts and receivables aging. */
export async function workbook(book: Book, from: string, to: string): Promise<Blob> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "Folio";
  wb.created = new Date();
  const tb = trialBalance(book, from, to);
  const is = incomeStatement(book, from, to);
  const bs = balanceSheet(book, to);
  const cf = cashFlow(book, from, to);
  const isRows = statementRows(is.lines);
  const bsRows = statementRows([
    ...bs.assets,
    { key: "ta", label: "Total assets", amount: bs.totalAssets, level: 0, total: true },
    ...bs.liabilities,
    ...bs.equity,
    { key: "tle", label: "Total liabilities and equity", amount: bs.totalLiabilities + bs.totalEquity, level: 0, total: true },
  ]);
  const cfRows = statementRows(cf.lines);
  const ag = aging(book, "invoice", to, (c) => rateOn(book, c, to) ?? 1);
  const sheets: Sheet[] = [
    { name: tx("Journal"), header: JOURNAL_HEADER, rows: journalRows(book, from, to), money: [7, 8, 10], widths: [8, 12, 44, 16, 10, 32, 14, 14, 9, 14, 10, 14] },
    {
      name: tx("Trial balance"),
      header: ["Account", "Account name", "Opening", "Debit", "Credit", "Closing"],
      rows: [...tb.rows.map((r) => [r.account.code, name(r.account), m(r.opening), m(r.debit), m(r.credit), m(r.closing)]), [tx("Total"), "", m(tb.totals.opening), m(tb.totals.debit), m(tb.totals.credit), m(tb.totals.closing)]],
      money: [3, 4, 5, 6],
      bold: [tb.rows.length],
      widths: [12, 40, 16, 16, 16, 16],
    },
    { name: tx("Income statement"), header: ["Line", "Account", "Amount"], rows: isRows.rows, money: [3], bold: isRows.bold, widths: [40, 40, 18] },
    { name: tx("Balance sheet"), header: ["Line", "Account", "Amount"], rows: bsRows.rows, money: [3], bold: bsRows.bold, widths: [40, 40, 18] },
    { name: tx("Cash flow"), header: ["Line", "Account", "Amount"], rows: cfRows.rows, money: [3], bold: cfRows.bold, widths: [44, 40, 18] },
    {
      name: tx("Receivables aging"),
      header: ["Invoice", "Customer", "Date", "Due date", "Days overdue", "Bucket", "Currency", "Open", "Open in TRY"],
      rows: ag.map((r) => [r.doc.number, r.party?.name ?? "", r.doc.date, r.doc.due, Math.max(0, r.days), tx(BUCKETS[r.bucket]), r.doc.currency, m(r.open), m(r.base)]),
      money: [8, 9],
      widths: [12, 30, 12, 12, 12, 14, 9, 14, 16],
    },
    {
      name: tx("Chart of accounts"),
      header: ["Account", "Account name", "Type", "Section"],
      rows: sortedAccounts(book).map((a) => [a.code, name(a), tx(TYPE[a.type]), a.header ? tx("Heading") : ""]),
      money: [],
      widths: [12, 48, 14, 12],
    },
  ];
  for (const s of sheets) {
    const ws = wb.addWorksheet(s.name.slice(0, 31), { views: [{ state: "frozen", ySplit: 1 }] });
    ws.addRow(s.header.map(tx));
    ws.getRow(1).font = { bold: true };
    for (const r of s.rows) ws.addRow(r);
    for (const c of s.money) ws.getColumn(c).numFmt = "#,##0.00;[Red]-#,##0.00";
    for (const b of s.bold ?? []) ws.getRow(b + 2).font = { bold: true };
    (s.widths ?? []).forEach((w, i) => (ws.getColumn(i + 1).width = w));
    if (s.rows.length) ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: s.header.length } };
  }
  const buf = await wb.xlsx.writeBuffer();
  return new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

export const TYPE: Record<string, string> = { asset: "Asset", liability: "Liability", equity: "Equity", income: "Income", expense: "Expense" };

export function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export { docTotals };
