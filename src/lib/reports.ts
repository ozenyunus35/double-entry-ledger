import { debitNormal, isBalanceSheet, type Account, type Section } from "./charts";
import { accountMap, balances, dayBefore, natural, sortedAccounts, type Balance } from "./ledger";
import type { Book, Entry } from "./types";

export interface TrialRow {
  account: Account;
  opening: number;
  debit: number;
  credit: number;
  closing: number;
}

/** Opening balance, period movements and closing balance per account; debit positive. Totals always net to zero. */
export function trialBalance(book: Book, from: string, to: string, opts: { includeClosing?: boolean } = {}): { rows: TrialRow[]; totals: { opening: number; debit: number; credit: number; closing: number } } {
  const exclude = opts.includeClosing ? undefined : (e: Entry) => e.source === "closing" && e.date >= from && e.date <= to;
  const open = balances(book, { to: dayBefore(from) });
  const move = balances(book, { from, to, exclude });
  const rows: TrialRow[] = [];
  for (const a of sortedAccounts(book)) {
    if (a.header) continue;
    const o = open.get(a.code);
    const m = move.get(a.code);
    const opening = o ? o.debit - o.credit : 0;
    const debit = m?.debit ?? 0;
    const credit = m?.credit ?? 0;
    if (!opening && !debit && !credit) continue;
    rows.push({ account: a, opening, debit, credit, closing: opening + debit - credit });
  }
  const totals = rows.reduce((t, r) => ({ opening: t.opening + r.opening, debit: t.debit + r.debit, credit: t.credit + r.credit, closing: t.closing + r.closing }), { opening: 0, debit: 0, credit: 0, closing: 0 });
  return { rows, totals };
}

export interface StatementLine {
  key: string;
  label: string;
  amount: number;
  accounts?: { account: Account; amount: number }[];
  level: 0 | 1 | 2;
  total?: boolean;
}

function sectionTotal(book: Book, bal: Map<string, Balance>, sections: Section[]) {
  const accounts: { account: Account; amount: number }[] = [];
  let total = 0;
  for (const a of sortedAccounts(book)) {
    if (a.header || !sections.includes(a.section)) continue;
    const b = bal.get(a.code);
    if (!b) continue;
    // Shown in the section's natural direction: contra accounts subtract.
    const s = b.debit - b.credit;
    const parentDebit = a.type === "asset" || a.type === "expense";
    const amount = parentDebit ? s : -s;
    if (amount === 0 && !natural(a, b)) continue;
    accounts.push({ account: a, amount });
    total += amount;
  }
  return { accounts, total };
}

export interface IncomeStatement {
  lines: StatementLine[];
  revenue: number;
  grossProfit: number;
  operatingProfit: number;
  beforeTax: number;
  net: number;
}

/** Profit and loss for a period. Closing entries are left out, so a closed year still shows its result. */
export function incomeStatement(book: Book, from: string, to: string): IncomeStatement {
  const bal = balances(book, { from, to, exclude: (e) => e.source === "closing" });
  const rev = sectionTotal(book, bal, ["revenue"]);
  const cos = sectionTotal(book, bal, ["cost-of-sales"]);
  const opex = sectionTotal(book, bal, ["operating-expenses"]);
  const oi = sectionTotal(book, bal, ["other-income"]);
  const oe = sectionTotal(book, bal, ["other-expenses"]);
  const tax = sectionTotal(book, bal, ["income-tax"]);
  const revenue = rev.total;
  const grossProfit = revenue - cos.total;
  const operatingProfit = grossProfit - opex.total;
  const beforeTax = operatingProfit + oi.total - oe.total;
  const net = beforeTax - tax.total;
  const lines: StatementLine[] = [
    { key: "revenue", label: "Revenue", amount: revenue, accounts: rev.accounts, level: 1 },
    { key: "cost-of-sales", label: "Cost of sales", amount: -cos.total, accounts: cos.accounts, level: 1 },
    { key: "gross-profit", label: "Gross profit", amount: grossProfit, level: 0, total: true },
    { key: "operating-expenses", label: "Operating expenses", amount: -opex.total, accounts: opex.accounts, level: 1 },
    { key: "operating-profit", label: "Operating profit", amount: operatingProfit, level: 0, total: true },
    { key: "other-income", label: "Other income", amount: oi.total, accounts: oi.accounts, level: 1 },
    { key: "other-expenses", label: "Other expenses", amount: -oe.total, accounts: oe.accounts, level: 1 },
    { key: "before-tax", label: "Profit before tax", amount: beforeTax, level: 0, total: true },
    { key: "income-tax", label: "Income tax", amount: -tax.total, accounts: tax.accounts, level: 1 },
    { key: "net", label: "Net profit", amount: net, level: 0, total: true },
  ];
  return { lines, revenue, grossProfit, operatingProfit, beforeTax, net };
}

export interface BalanceSheet {
  date: string;
  assets: StatementLine[];
  liabilities: StatementLine[];
  equity: StatementLine[];
  totalAssets: number;
  totalLiabilities: number;
  totalEquity: number;
  /** Profit or loss not yet closed into retained earnings. */
  unclosed: number;
  /** Assets minus liabilities and equity; zero for books kept by this ledger. */
  difference: number;
}

export function balanceSheet(book: Book, date: string): BalanceSheet {
  const bal = balances(book, { to: date });
  const groups = (pairs: [string, string, Section[]][]) =>
    pairs.map(([key, label, sections]) => {
      const s = sectionTotal(book, bal, sections);
      return { key, label, amount: s.total, accounts: s.accounts, level: 1 as const };
    });
  const assets = groups([
    ["cash", "Cash and banks", ["cash"]],
    ["receivables", "Trade receivables", ["receivables"]],
    ["tax-assets", "VAT and tax assets", ["tax-assets"]],
    ["other-current-assets", "Other current assets", ["other-current-assets"]],
    ["fixed-assets", "Fixed assets, net", ["fixed-assets"]],
  ]);
  const liabilities = groups([
    ["current-liabilities", "Current liabilities", ["current-liabilities"]],
    ["long-term-liabilities", "Long-term liabilities", ["long-term-liabilities"]],
  ]);
  const eq = sectionTotal(book, bal, ["equity"]);
  // Income and expense balances still open (the year isn't closed yet) belong to equity.
  let unclosed = 0;
  const accounts = accountMap(book);
  for (const [c, b] of bal) {
    const a = accounts.get(c);
    if (a && !isBalanceSheet(a)) unclosed -= b.debit - b.credit;
  }
  const equity: StatementLine[] = [{ key: "equity", label: "Equity", amount: eq.total, accounts: eq.accounts, level: 1 }];
  if (unclosed !== 0) equity.push({ key: "unclosed", label: "Profit for the period (not yet closed)", amount: unclosed, level: 1 });
  const totalAssets = assets.reduce((a, l) => a + l.amount, 0);
  const totalLiabilities = liabilities.reduce((a, l) => a + l.amount, 0);
  const totalEquity = eq.total + unclosed;
  return { date, assets, liabilities, equity, totalAssets, totalLiabilities, totalEquity, unclosed, difference: totalAssets - totalLiabilities - totalEquity };
}

export interface CashFlow {
  lines: StatementLine[];
  operating: number;
  investing: number;
  financing: number;
  fxEffect: number;
  opening: number;
  closing: number;
  /** Opening cash + flows − closing cash; zero when the statement ties out. */
  difference: number;
}

const OPERATING: Section[] = ["receivables", "tax-assets", "other-current-assets", "current-liabilities"];

/** Cash flow statement, indirect method: net profit adjusted for non-cash items and working capital changes. */
export function cashFlow(book: Book, from: string, to: string): CashFlow {
  const accounts = accountMap(book);
  const move = balances(book, { from, to, exclude: (e) => e.source === "closing" });
  const net = incomeStatement(book, from, to).net;
  const open = balances(book, { to: dayBefore(from) });
  const close = balances(book, { to });
  const cashOf = (m: Map<string, Balance>) => {
    let s = 0;
    for (const [c, b] of m) if (accounts.get(c)?.section === "cash") s += b.debit - b.credit;
    return s;
  };
  // Revaluation of foreign cash is a gain in profit but moves no cash: shown apart as the effect of exchange rates.
  let fxEffect = 0;
  for (const e of book.entries) {
    if (e.status !== "posted" || e.source !== "revaluation" || e.date < from || e.date > to) continue;
    for (const l of e.lines) if (accounts.get(l.account)?.section === "cash") fxEffect += l.debit - l.credit;
  }
  const change = (sections: Section[], role?: string) => {
    const rows: { account: Account; amount: number }[] = [];
    let total = 0;
    for (const a of sortedAccounts(book)) {
      if (a.header || !sections.includes(a.section)) continue;
      if (role === "depreciation" ? a.role !== "accumulated-depreciation" : role === "assets" ? a.role === "accumulated-depreciation" : false) continue;
      const b = move.get(a.code);
      if (!b) continue;
      // Cash effect of a balance sheet movement is its credit minus its debit.
      const amount = b.credit - b.debit;
      if (!amount) continue;
      rows.push({ account: a, amount });
      total += amount;
    }
    return { rows, total };
  };
  const dep = change(["fixed-assets"], "depreciation");
  const wc = change(OPERATING);
  const inv = change(["fixed-assets"], "assets");
  const fin = change(["long-term-liabilities", "equity"]);
  const operating = net - fxEffect + dep.total + wc.total;
  const investing = inv.total;
  const financing = fin.total;
  const opening = cashOf(open);
  const closing = cashOf(close);
  const lines: StatementLine[] = [
    { key: "net", label: "Net profit", amount: net, level: 1 },
    { key: "depreciation", label: "Depreciation", amount: dep.total, accounts: dep.rows, level: 1 },
    { key: "fx-unrealised", label: "Unrealised exchange differences on cash", amount: -fxEffect, level: 1 },
    { key: "working-capital", label: "Change in working capital", amount: wc.total, accounts: wc.rows, level: 1 },
    { key: "operating", label: "Cash from operating activities", amount: operating, level: 0, total: true },
    { key: "investing", label: "Cash from investing activities", amount: investing, accounts: inv.rows, level: 0, total: true },
    { key: "financing", label: "Cash from financing activities", amount: financing, accounts: fin.rows, level: 0, total: true },
    { key: "fx", label: "Effect of exchange rates on cash", amount: fxEffect, level: 1 },
    { key: "change", label: "Net change in cash", amount: operating + investing + financing + fxEffect, level: 0, total: true },
    { key: "opening", label: "Cash at the start", amount: opening, level: 1 },
    { key: "closing", label: "Cash at the end", amount: closing, level: 0, total: true },
  ];
  return { lines, operating, investing, financing, fxEffect, opening, closing, difference: opening + operating + investing + financing + fxEffect - closing };
}

export interface LedgerRow {
  entry: Entry;
  debit: number;
  credit: number;
  balance: number;
  memo: string;
  fx?: { currency: string; amount: number };
}

/** One account's general ledger with a running balance in its natural direction. */
export function accountLedger(book: Book, code: string, from: string, to: string): { account: Account; opening: number; rows: LedgerRow[]; closing: number; debit: number; credit: number } {
  const account = accountMap(book).get(code);
  if (!account) throw new Error(`No account ${code}`);
  const dir = debitNormal(account) ? 1 : -1;
  const ob = balances(book, { to: dayBefore(from) }).get(code);
  const opening = ob ? dir * (ob.debit - ob.credit) : 0;
  const rows: LedgerRow[] = [];
  let bal = opening;
  let debit = 0;
  let credit = 0;
  const entries = book.entries.filter((e) => e.status === "posted" && e.date >= from && e.date <= to && e.lines.some((l) => l.account === code)).sort((a, b) => a.date.localeCompare(b.date) || (a.no ?? 0) - (b.no ?? 0));
  for (const e of entries) {
    for (const l of e.lines) {
      if (l.account !== code) continue;
      bal += dir * (l.debit - l.credit);
      debit += l.debit;
      credit += l.credit;
      rows.push({ entry: e, debit: l.debit, credit: l.credit, balance: bal, memo: l.memo ?? e.memo, fx: l.currency && l.fx ? { currency: l.currency, amount: l.debit ? l.fx : -l.fx } : undefined });
    }
  }
  return { account, opening, rows, closing: bal, debit, credit };
}

/** Month by month revenue, expenses and profit, for the dashboard chart. */
export function monthly(book: Book, months: string[]): { month: string; revenue: number; expenses: number; profit: number; cash: number }[] {
  const accounts = accountMap(book);
  return months.map((m) => {
    const from = `${m}-01`;
    const to = new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0)).toISOString().slice(0, 10);
    const is = incomeStatement(book, from, to);
    const close = balances(book, { to });
    let cash = 0;
    for (const [c, b] of close) if (accounts.get(c)?.section === "cash") cash += b.debit - b.credit;
    return { month: m, revenue: is.revenue, expenses: is.revenue - is.net, profit: is.net, cash };
  });
}
