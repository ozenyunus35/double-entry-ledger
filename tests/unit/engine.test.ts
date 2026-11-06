import { describe, expect, it } from "vitest";
import { CHARTS, INTL, TDHP, checkChart } from "@/lib/charts";
import { closeYear, settleVat, vatReport } from "@/lib/close";
import { createDoc, openAmount, recordPayment, voidDoc } from "@/lib/docs";
import { revalue } from "@/lib/fx";
import { LedgerError, addMonths, balances, code, monthEnd, deleteDraft, lockThrough, postDraft, postEntry, reverseEntry, saveDraft, unlock, validateEntry } from "@/lib/ledger";
import { allocate, detectDecimal, parseAmount, toMinor } from "@/lib/money";
import { balanceSheet, cashFlow, incomeStatement, trialBalance } from "@/lib/reports";
import { demoBook, emptyBook } from "@/lib/seed";
import type { Book } from "@/lib/types";

const TODAY = "2026-11-06";

function rules(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    if (e instanceof LedgerError) return e.code;
    throw e;
  }
  return "ok";
}

describe("money", () => {
  it.each([
    ["1,234.56", 123456],
    ["1.234,56", 123456],
    ["1 234,56", 123456],
    ["₺1.234", 123400],
    ["(500.00)", -50000],
    ["-12,5", -1250],
    ["1.234,56-", -123456],
    ["12,50 TL", 1250],
    ["€ 3.000", 300000],
    ["$3,000", 300000],
    ["0,07", 7],
    [".5", 50],
    ["1.234.567,89", 123456789],
    ["1,234,567.89", 123456789],
    ["1'234.50", 123450],
  ])("reads %s", (s, want) => expect(parseAmount(s)).toBe(want));

  it.each(["", "abc", "1.2.3", "12,34,5", "1,23,456.00", "1.2345678", "--5", "1e5"])("rejects %j", (s) => expect(parseAmount(s)).toBeNull());

  it("uses the file's decimal mark for ambiguous values", () => {
    expect(parseAmount("1.234", ",")).toBe(123400);
    expect(parseAmount("1.234", ".")).toBe(123);
    expect(detectDecimal(["1.234,50", "12,00", "1.000"])).toBe(",");
    expect(detectDecimal(["1,234.50", "12.00"])).toBe(".");
    expect(detectDecimal(["1.000", "2.000"])).toBeNull();
  });

  it("rounds half away from zero and allocates without losing a kuruş", () => {
    expect(toMinor(0.005)).toBe(1);
    expect(toMinor(-0.005)).toBe(-1);
    expect(toMinor(1.005)).toBe(101);
    const parts = allocate(10000, [1, 1, 1]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(10000);
    expect(Math.max(...parts) - Math.min(...parts)).toBeLessThanOrEqual(1);
  });
});

describe("charts", () => {
  it("have unique codes and roles, and headers for every sub-account", () => {
    expect(checkChart(INTL)).toEqual([]);
    expect(checkChart(TDHP)).toEqual([]);
  });
  it("cover the same roles, so the same books can be kept in either", () => {
    const roles = (c: typeof INTL) => c.filter((a) => a.role).map((a) => a.role).sort();
    expect(roles(INTL)).toEqual(roles(TDHP));
  });
});

function fresh(chart: "intl" | "tdhp" = "tdhp"): Book {
  return { ...emptyBook(chart, "Test"), parties: [{ id: "c1", name: "Customer", kind: "customer", country: "DE", currency: "EUR", terms: 30 }, { id: "s1", name: "Supplier", kind: "supplier", country: "TR", currency: "TRY", terms: 10 }], rates: [{ date: "2026-01-01", currency: "EUR", rate: 50 }, { date: "2026-02-01", currency: "EUR", rate: 52 }, { date: "2026-03-01", currency: "EUR", rate: 49 }] };
}

describe("posting rules", () => {
  const b0 = fresh();
  const bank = code(b0, "bank-try");
  const sales = code(b0, "sales-domestic");

  it("refuses an entry that doesn't balance to the kuruş", () => {
    const issues = validateEntry(b0, { date: "2026-01-10", lines: [{ account: bank, debit: 10001, credit: 0 }, { account: sales, debit: 0, credit: 10000 }] });
    expect(issues.map((i) => i.code)).toContain("unbalanced");
  });

  it.each([
    ["one line", [{ account: "102.01", debit: 100, credit: 0 }], "too-few-lines"],
    ["unknown account", [{ account: "999", debit: 100, credit: 0 }, { account: "600", debit: 0, credit: 100 }], "unknown-account"],
    ["heading", [{ account: "102", debit: 100, credit: 0 }, { account: "600", debit: 0, credit: 100 }], "header-account"],
    ["negative", [{ account: "102.01", debit: -100, credit: 0 }, { account: "600", debit: 0, credit: -100 }], "negative"],
    ["both sides", [{ account: "102.01", debit: 100, credit: 100 }, { account: "600", debit: 0, credit: 0 }], "both-sides"],
    ["fractional kuruş", [{ account: "102.01", debit: 100.5, credit: 0 }, { account: "600", debit: 0, credit: 100.5 }], "not-integer"],
    ["foreign line without rate", [{ account: "102.02", debit: 5000, credit: 0, currency: "EUR" as const, fx: 100 }, { account: "600", debit: 0, credit: 5000 }], "fx-incomplete"],
    ["foreign amount that doesn't convert", [{ account: "102.02", debit: 6000, credit: 0, currency: "EUR" as const, fx: 100, rate: 50 }, { account: "600", debit: 0, credit: 6000 }], "fx-mismatch"],
  ])("refuses %s", (_, lines, want) => {
    expect(validateEntry(b0, { date: "2026-01-10", lines }).map((i) => i.code)).toContain(want);
  });

  it.each(["2026-02-30", "2026-13-01", "26-01-01", "", "2026-1-5"])("refuses the date %j", (date) => {
    expect(validateEntry(b0, { date, lines: [{ account: bank, debit: 1, credit: 0 }, { account: sales, debit: 0, credit: 1 }] }).map((i) => i.code)).toContain("bad-date");
  });

  it("numbers posted entries in order, keeps drafts out of balances and freezes posted entries", () => {
    let b = fresh();
    const d = saveDraft(b, { date: "2026-01-05", memo: "draft", lines: [{ account: bank, debit: 100, credit: 0 }] });
    b = d.book;
    expect(balances(b).size).toBe(0);
    expect(rules(() => postDraft(b, d.entry.id))).toBe("too-few-lines");
    const p = postEntry(b, { date: "2026-01-06", memo: "sale", lines: [{ account: bank, debit: 100, credit: 0 }, { account: sales, debit: 0, credit: 100 }] });
    b = p.book;
    expect(p.entry.no).toBe(1);
    expect(rules(() => saveDraft(b, { date: "2026-01-06", memo: "x", lines: [] }, p.entry.id))).toBe("posted-immutable");
    expect(rules(() => deleteDraft(b, p.entry.id))).toBe("posted-immutable");
    b = deleteDraft(b, d.entry.id);
    expect(b.entries).toHaveLength(1);
  });

  it("corrects a posted entry by reversal, once, and not before the original", () => {
    let b = fresh();
    const p = postEntry(b, { date: "2026-01-06", memo: "sale", lines: [{ account: bank, debit: 100, credit: 0 }, { account: sales, debit: 0, credit: 100 }] });
    b = p.book;
    expect(rules(() => reverseEntry(b, p.entry.id, "2026-01-05"))).toBe("reversal-before");
    const r = reverseEntry(b, p.entry.id, "2026-01-07");
    b = r.book;
    expect(balances(b).get(bank)).toMatchObject({ debit: 100, credit: 100 });
    expect(rules(() => reverseEntry(b, p.entry.id, "2026-01-08"))).toBe("already-reversed");
    expect(rules(() => reverseEntry(b, r.entry.id, "2026-01-08"))).toBe("is-reversal");
  });

  it("locks a period against posting, editing and reversing into it", () => {
    let b = fresh();
    const p = postEntry(b, { date: "2026-01-06", memo: "sale", lines: [{ account: bank, debit: 100, credit: 0 }, { account: sales, debit: 0, credit: 100 }] });
    b = lockThrough(p.book, "2026-01-31");
    expect(rules(() => postEntry(b, { date: "2026-01-20", memo: "late", lines: [{ account: bank, debit: 1, credit: 0 }, { account: sales, debit: 0, credit: 1 }] }))).toBe("locked");
    expect(rules(() => reverseEntry(b, p.entry.id, "2026-01-31"))).toBe("locked");
    expect(rules(() => reverseEntry(b, p.entry.id, "2026-02-01"))).toBe("ok");
    expect(rules(() => unlock(b, "2026-02-15"))).toBe("unlock-later");
    expect(unlock(b, null).lockedThrough).toBeNull();
  });
});

describe("invoices, payments and exchange differences", () => {
  it("books a euro invoice, a later payment at a better rate, and the realised gain", () => {
    let b = fresh();
    const inv = createDoc(b, { kind: "invoice", number: "A-1", party: "c1", date: "2026-01-10", due: "2026-02-09", currency: "EUR", rate: 50, lines: [{ description: "Design", quantity: 1, price: 100000, vat: 0, account: code(b, "sales-export") }] });
    b = inv.book;
    expect(balances(b).get(code(b, "receivables"))).toMatchObject({ debit: 5_000_000, fx: { EUR: 100000 } });
    expect(rules(() => createDoc(b, { kind: "invoice", number: "a-1", party: "c1", date: "2026-01-11", due: "2026-02-09", currency: "EUR", rate: 50, lines: [{ description: "x", quantity: 1, price: 100, vat: 0, account: code(b, "sales-export") }] }))).toBe("doc-duplicate");
    expect(rules(() => recordPayment(b, inv.doc.id, { date: "2026-02-10", amount: 100001, rate: 52, account: code(b, "bank-eur") }))).toBe("pay-over");
    expect(rules(() => recordPayment(b, inv.doc.id, { date: "2026-02-10", amount: 100000, rate: 52, account: code(b, "bank-usd") }))).toBe("pay-currency");
    b = recordPayment(b, inv.doc.id, { date: "2026-02-10", amount: 100000, rate: 52, account: code(b, "bank-eur") }).book;
    const bal = balances(b);
    expect(bal.get(code(b, "receivables"))).toMatchObject({ debit: 5_000_000, credit: 5_000_000 });
    expect(bal.get(code(b, "fx-gain"))?.credit).toBe(200_000);
    expect(openAmount(b.docs[0])).toBe(0);
  });

  it("revalues open foreign balances at month end and clears them at the carried rate", () => {
    let b = fresh();
    b = createDoc(b, { kind: "invoice", number: "A-1", party: "c1", date: "2026-01-10", due: "2026-02-09", currency: "EUR", rate: 50, lines: [{ description: "Design", quantity: 1, price: 100000, vat: 0, account: code(b, "sales-export") }] }).book;
    b = revalue(b, "2026-02-28").book;
    expect(balances(b).get(code(b, "fx-gain"))?.credit).toBe(200_000);
    expect(rules(() => revalue(b, "2026-02-28"))).toBe("already-revalued");
    // Paid in March at 49: carried at 52, so a loss of 3 per euro; the total effect is 49 − 50 = −1 per euro.
    b = recordPayment(b, b.docs[0].id, { date: "2026-03-05", amount: 100000, rate: 49, account: code(b, "bank-eur") }).book;
    const bal = balances(b);
    expect((bal.get(code(b, "fx-gain"))?.credit ?? 0) - (bal.get(code(b, "fx-loss"))?.debit ?? 0)).toBe(-100_000);
    const r = bal.get(code(b, "receivables"))!;
    expect(r.debit - r.credit).toBe(0);
  });

  it("voids only unpaid documents", () => {
    let b = fresh();
    const inv = createDoc(b, { kind: "invoice", number: "A-1", party: "c1", date: "2026-01-10", due: "2026-02-09", currency: "EUR", rate: 50, lines: [{ description: "Design", quantity: 1, price: 100000, vat: 0, account: code(b, "sales-export") }] });
    b = voidDoc(inv.book, inv.doc.id, "2026-01-12");
    expect(openAmount(b.docs[0])).toBe(0);
    expect(balances(b).get(code(b, "receivables"))).toMatchObject({ debit: 5_000_000, credit: 5_000_000 });
  });
});

describe("VAT and year-end", () => {
  it("settles VAT to pay, then carries input VAT forward when purchases exceed sales", () => {
    let b = fresh();
    b = createDoc(b, { kind: "invoice", number: "T-1", party: "c1", date: "2026-01-10", due: "2026-01-20", currency: "TRY", rate: 1, lines: [{ description: "Local job", quantity: 1, price: 1_000_000, vat: 20, account: code(b, "sales-domestic") }] }).book;
    b = createDoc(b, { kind: "bill", number: "R-1", party: "s1", date: "2026-01-11", due: "2026-01-20", currency: "TRY", rate: 1, lines: [{ description: "Rent", quantity: 1, price: 400_000, vat: 20, account: code(b, "rent") }] }).book;
    expect(vatReport(b, "2026-01")).toMatchObject({ output: 200_000, input: 80_000, payable: 120_000 });
    b = settleVat(b, "2026-01").book;
    expect(rules(() => settleVat(b, "2026-01"))).toBe("vat-settled");
    b = createDoc(b, { kind: "bill", number: "R-2", party: "s1", date: "2026-02-11", due: "2026-02-20", currency: "TRY", rate: 1, lines: [{ description: "Rent", quantity: 1, price: 400_000, vat: 20, account: code(b, "rent") }] }).book;
    b = settleVat(b, "2026-02").book;
    const bal = balances(b);
    expect(bal.get(code(b, "vat-carried"))?.debit).toBe(80_000);
    expect(bal.get(code(b, "taxes-payable"))?.credit).toBe(120_000);
    expect(vatReport(b, "2026-03").carriedIn).toBe(80_000);
  });

  it("closes a year into retained earnings and locks it", () => {
    let b = fresh();
    const bank = code(b, "bank-try");
    b = postEntry(b, { date: "2025-06-01", memo: "sale", lines: [{ account: bank, debit: 500_000, credit: 0 }, { account: code(b, "sales-domestic"), debit: 0, credit: 500_000 }] }).book;
    b = postEntry(b, { date: "2025-07-01", memo: "rent", lines: [{ account: code(b, "rent"), debit: 200_000, credit: 0 }, { account: bank, debit: 0, credit: 200_000 }] }).book;
    const res = closeYear(b, 2025);
    b = res.book;
    const bal = balances(b);
    expect(bal.get(code(b, "retained-earnings"))?.credit).toBe(300_000);
    expect(bal.get(code(b, "sales-domestic"))).toMatchObject({ debit: 500_000, credit: 500_000 });
    expect(b.lockedThrough).toBe("2025-12-31");
    expect(incomeStatement(b, "2025-01-01", "2025-12-31").net).toBe(300_000);
    expect(rules(() => closeYear(b, 2025))).toBe("year-closed-already");
    expect(rules(() => unlock(b, "2025-06-30"))).toBe("year-closed");
  });
});

describe.each(["tdhp", "intl"] as const)("demo books (%s)", (chart) => {
  const b = demoBook(chart, TODAY);
  const posted = b.entries.filter((e) => e.status === "posted");

  it("has a year of activity with every entry balanced and numbered once", () => {
    expect(posted.length).toBeGreaterThan(250);
    for (const e of posted) expect(validateEntry({ ...b, lockedThrough: null }, e)).toEqual([]);
    const nos = posted.map((e) => e.no);
    expect(new Set(nos).size).toBe(nos.length);
    expect(b.entries.filter((e) => e.status === "draft")).toHaveLength(2);
  });

  it("keeps the trial balance at zero for any period", () => {
    for (const [from, to] of [["2025-12-01", TODAY], ["2026-01-01", "2026-06-30"], ["2026-03-01", "2026-03-31"]]) {
      const tb = trialBalance(b, from, to);
      expect(tb.totals.opening).toBe(0);
      expect(tb.totals.debit).toBe(tb.totals.credit);
      expect(tb.totals.closing).toBe(0);
    }
  });

  it("balances the balance sheet at every month end", () => {
    for (const d of ["2025-12-31", "2026-01-31", "2026-04-30", "2026-08-31", TODAY]) expect(balanceSheet(b, d).difference).toBe(0);
  });

  it("ties the cash flow statement to the change in cash", () => {
    for (const [from, to] of [["2026-01-01", TODAY], ["2026-04-01", "2026-06-30"], ["2025-12-01", "2025-12-31"]]) expect(cashFlow(b, from, to).difference).toBe(0);
  });

  it("closed last year, locked up to two months ago, and leaves the open month editable", () => {
    expect(b.closedYears).toEqual([2025]);
    expect(b.lockedThrough).toBe("2026-09-30");
    const is2026 = incomeStatement(b, "2026-01-01", TODAY);
    expect(is2026.revenue).toBeGreaterThan(0);
  });

  it("never lets a bank account run below zero at a month end", () => {
    const banks = b.accounts.filter((a) => a.section === "cash" && !a.header).map((a) => a.code);
    for (let m = "2025-12"; m <= "2026-10"; m = addMonths(m, 1)) {
      const bal = balances(b, { to: monthEnd(m) });
      for (const code of banks) {
        const x = bal.get(code);
        expect(x ? x.debit - x.credit : 0, `${code} at ${m}`).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("has overdue invoices, a part-paid one and foreign balances", () => {
    const open = b.docs.filter((d) => d.kind === "invoice" && openAmount(d) > 0);
    expect(open.length).toBeGreaterThan(2);
    expect(open.some((d) => d.due < TODAY)).toBe(true);
    expect(b.docs.some((d) => d.payments.length && openAmount(d) > 0)).toBe(true);
  });
});

it("builds the same books in both charts", () => {
  const a = demoBook("tdhp", TODAY);
  const b = demoBook("intl", TODAY);
  expect(incomeStatement(a, "2026-01-01", TODAY).net).toBe(incomeStatement(b, "2026-01-01", TODAY).net);
  expect(balanceSheet(a, TODAY).totalAssets).toBe(balanceSheet(b, TODAY).totalAssets);
  expect(CHARTS.tdhp.length).toBeGreaterThan(30);
});
