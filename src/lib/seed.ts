import { CHARTS, type ChartId, type Role } from "./charts";
import { closeYear, settleVat } from "./close";
import { createDoc, openAmount, recordPayment } from "./docs";
import { carryingRate, rateOn, revalue } from "./fx";
import { addDays, addMonths, balances, code, lockThrough, monthEnd, postEntry, saveDraft } from "./ledger";
import { convert, toMinor, type Currency } from "./money";
import { runRecurring } from "./recurring";
import { incomeStatement } from "./reports";
import type { Book, DocLine, Line, Party, Rate } from "./types";

/**
 * Kuzey Studio: a fictional Istanbul design studio with clients in the US, Germany, France and Türkiye.
 * Twelve months of books are generated around today with the ledger's own functions, so the demo data
 * passes every rule a user's entries have to pass. Nothing here is a real company.
 */

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const PARTIES: Party[] = [
  { id: "c-halden", name: "Halden Hair Studio", kind: "customer", country: "US", currency: "USD", terms: 30, email: "accounts@halden.example" },
  { id: "c-northfold", name: "Northfold Outdoor", kind: "customer", country: "US", currency: "USD", terms: 30, email: "ap@northfold.example" },
  { id: "c-brightwater", name: "Brightwater Supply Co.", kind: "customer", country: "US", currency: "USD", terms: 45, email: "billing@brightwater.example" },
  { id: "c-lumen", name: "Lumen & Ash Studio", kind: "customer", country: "DE", currency: "EUR", terms: 30, taxId: "DE000000001", email: "office@lumenash.example" },
  { id: "c-nordlicht", name: "Nordlicht GmbH", kind: "customer", country: "DE", currency: "EUR", terms: 30, taxId: "DE000000002", email: "buchhaltung@nordlicht.example" },
  { id: "c-moreau", name: "Atelier Moreau", kind: "customer", country: "FR", currency: "EUR", terms: 45, taxId: "FR00000000003", email: "compta@moreau.example" },
  { id: "c-kahve", name: "Moda Kahve Kavurma", kind: "customer", country: "TR", currency: "TRY", terms: 15, taxId: "1111111111", email: "muhasebe@modakahve.example" },
  { id: "c-otel", name: "Mavi Koy Otel", kind: "customer", country: "TR", currency: "TRY", terms: 30, taxId: "2222222222", email: "finans@mavikoy.example" },
  { id: "c-ege", name: "Ege Tekstil A.Ş.", kind: "customer", country: "TR", currency: "TRY", terms: 30, taxId: "3333333333", email: "fatura@egetekstil.example" },
  { id: "s-ofis", name: "Kadıköy Ofis Gayrimenkul", kind: "supplier", country: "TR", currency: "TRY", terms: 5, taxId: "4444444444" },
  { id: "s-pixelforge", name: "Pixelforge Inc.", kind: "supplier", country: "US", currency: "USD", terms: 0 },
  { id: "s-cloudnine", name: "Cloudnine Hosting LLC", kind: "supplier", country: "US", currency: "USD", terms: 0 },
  { id: "s-musavir", name: "Kaya Mali Müşavirlik", kind: "supplier", country: "TR", currency: "TRY", terms: 10, taxId: "5555555555" },
  { id: "s-telekom", name: "Boğaz Telekom A.Ş.", kind: "supplier", country: "TR", currency: "TRY", terms: 10, taxId: "6666666666" },
  { id: "s-bilgi", name: "Bilgi Teknoloji Mağazaları", kind: "supplier", country: "TR", currency: "TRY", terms: 0, taxId: "7777777777" },
  { id: "s-seyahat", name: "Anadolu Seyahat Acentesi", kind: "supplier", country: "TR", currency: "TRY", terms: 7, taxId: "8888888888" },
  { id: "s-ajans", name: "Kıyı Medya Reklam", kind: "supplier", country: "TR", currency: "TRY", terms: 15, taxId: "9999999999" },
  { id: "s-kolektif", name: "Serbest Tasarımcılar Kolektifi", kind: "supplier", country: "TR", currency: "TRY", terms: 20, taxId: "1212121212" },
  { id: "s-novak", name: "Marta Novak Illustration", kind: "supplier", country: "PL", currency: "EUR", terms: 14 },
];

const SERVICES = {
  export: ["Brand identity system", "Website design and build", "Product UI design sprint", "Packaging design", "Design system maintenance", "Campaign visuals", "Motion design package", "App onboarding redesign"],
  domestic: ["Logo and visual identity", "Menu and signage design", "Web site redesign", "Social media templates", "Catalogue design", "Photography art direction"],
};

/** Synthetic daily rates: a slow climb with noise, roughly where the lira traded in 2026. Not market data. */
function makeRates(from: string, to: string, rand: () => number): Rate[] {
  const out: Rate[] = [];
  let usd = 41.2;
  let eur = 48.1;
  for (let d = from; d <= to; d = addDays(d, 1)) {
    usd *= 1 + 0.00022 + (rand() - 0.5) * 0.0024;
    eur *= 1 + 0.00024 + (rand() - 0.5) * 0.0042;
    out.push({ date: d, currency: "USD", rate: Math.round(usd * 10000) / 10000 }, { date: d, currency: "EUR", rate: Math.round(eur * 10000) / 10000 });
  }
  return out;
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

export function emptyBook(chart: ChartId, name = "New company", today = iso(new Date())): Book {
  return {
    id: `book-${chart}-${Math.random().toString(36).slice(2, 8)}`,
    name,
    legalName: name,
    taxId: "",
    city: "",
    chart,
    base: "TRY",
    accounts: CHARTS[chart].map((a) => ({ ...a, name: { ...a.name } })),
    entries: [],
    parties: [],
    docs: [],
    rates: [],
    recurring: [],
    lockedThrough: null,
    closedYears: [],
    audit: [],
    nextNo: 1,
    demo: false,
    createdAt: today,
  };
}

/** Builds the demo books, dated so that the last twelve months end today. */
export function demoBook(chart: ChartId, today: string): Book {
  const rand = rng(20261106);
  const r = (min: number, max: number) => min + rand() * (max - min);
  const pick = <T,>(xs: T[]) => xs[Math.floor(rand() * xs.length)];
  const first = addMonths(today.slice(0, 7), -11);
  const start = `${first}-01`;
  let b: Book = {
    ...emptyBook(chart, "Kuzey Studio", today),
    id: `demo-${chart}`,
    legalName: "Kuzey Tasarım Stüdyosu Ltd. Şti.",
    taxId: "0000000000",
    city: "İstanbul",
    parties: PARTIES.map((p) => ({ ...p })),
    rates: makeRates(addDays(start, -40), today, rand),
    demo: true,
  };
  const c = (role: Role) => code(b, role);
  const at = (date: string) => `${date}T09:${String(Math.floor(rand() * 60)).padStart(2, "0")}:00.000Z`;
  const rate = (cur: Currency, date: string) => rateOn(b, cur, date) ?? 1;
  const post = (date: string, memo: string, lines: Line[], source: Parameters<typeof postEntry>[1]["source"] = "manual", ref?: string) => {
    const res = postEntry(b, { date, memo, lines, source, ref }, at(date));
    b = res.book;
    return res.entry;
  };
  /** A two-line entry: one account debited, one credited. */
  const pair = (date: string, memo: string, debit: Role, credit: Role, amount: number, ref?: string) =>
    post(date, memo, [
      { account: c(debit), debit: amount, credit: 0 },
      { account: c(credit), debit: 0, credit: amount },
    ], "manual", ref);
  const fxLine = (role: Role, cur: Currency, fx: number, date: string, side: "debit" | "credit"): Line => {
    const rt = rate(cur, date);
    const base = convert(fx, rt);
    return { account: c(role), debit: side === "debit" ? base : 0, credit: side === "credit" ? base : 0, currency: cur, fx, rate: rt };
  };

  // Opening balances carried in from earlier years.
  const eurBank = fxLine("bank-eur", "EUR", toMinor(14_250), start, "debit");
  const usdBank = fxLine("bank-usd", "USD", toMinor(9_820), start, "debit");
  const tryBank = toMinor(684_300);
  const equipment = toMinor(398_000);
  const accDep = toMinor(118_400);
  const capital = toMinor(250_000);
  const carried = toMinor(36_900);
  const assets = tryBank + eurBank.debit + usdBank.debit + equipment + carried + toMinor(4_200);
  post(
    start,
    "Opening balances",
    [
      { account: c("bank-try"), debit: tryBank, credit: 0 },
      eurBank,
      usdBank,
      { account: c("cash"), debit: toMinor(4_200), credit: 0 },
      { account: c("equipment"), debit: equipment, credit: 0 },
      { account: c("vat-carried"), debit: carried, credit: 0 },
      { account: c("accumulated-depreciation"), debit: 0, credit: accDep },
      { account: c("capital"), debit: 0, credit: capital },
      { account: c("retained-earnings"), debit: 0, credit: assets - accDep - capital },
    ],
    "opening",
  );

  // Depreciation runs from a recurring template, the way a bookkeeper would set it up.
  b = {
    ...b,
    recurring: [
      {
        id: "rec-dep",
        name: "Monthly depreciation",
        day: 31,
        start: first,
        last: null,
        memo: "Depreciation of equipment (36 months, straight line)",
        lines: [
          { account: c("depreciation"), debit: toMinor(11_055.56), credit: 0 },
          { account: c("accumulated-depreciation"), debit: 0, credit: toMinor(11_055.56) },
        ],
        active: true,
      },
    ],
  };

  /** Sells euros or dollars for lira when the lira account runs low, as the studio's bank would. */
  const topUp = (date: string) => {
    const bal = balances(b, { to: date });
    const net = (role: Role) => {
      const x = bal.get(c(role));
      return x ? x.debit - x.credit : 0;
    };
    const fxBal = (role: Role, cur: Currency) => bal.get(c(role))?.fx[cur] ?? 0;
    let need = toMinor(1_400_000) - net("bank-try");
    if (need <= toMinor(700_000)) return;
    for (const [role, cur] of [["bank-eur", "EUR"], ["bank-usd", "USD"]] as const) {
      if (need <= 0) break;
      const rt = rate(cur, date) * 0.996;
      const available = fxBal(role, cur) - toMinor(1_500);
      if (available <= 0) continue;
      const fx = Math.min(available, Math.ceil(need / rt / 100) * 100);
      const proceeds = convert(fx, rt);
      const carriedAt = carryingRate(b, c(role), cur, date) ?? rt;
      const carried = convert(fx, carriedAt);
      const lines: Line[] = [
        { account: c("bank-try"), debit: proceeds, credit: 0 },
        { account: c(role), debit: 0, credit: carried, currency: cur, fx, rate: carried / fx },
      ];
      const diff = proceeds - carried;
      if (diff > 0) lines.push({ account: c("fx-gain"), debit: 0, credit: diff });
      if (diff < 0) lines.push({ account: c("fx-loss"), debit: -diff, credit: 0 });
      post(date, `${cur} sold for TRY`, lines, "manual", `FX-${date.replace(/-/g, "")}-${cur}`);
      need -= proceeds;
    }
  };

  let invNo = 241;
  const invoices: { id: string; delay: number; partial?: boolean; never?: boolean }[] = [];
  const bills: { id: string; pay: string }[] = [];
  const months = Array.from({ length: 12 }, (_, i) => addMonths(first, i));

  const bill = (party: string, date: string, lines: DocLine[], cur: Currency, number: string, payOn: string) => {
    const p = b.parties.find((x) => x.id === party)!;
    const res = createDoc(b, { kind: "bill", number, party, date, due: addDays(date, p.terms), currency: cur, rate: rate(cur, date), lines }, at(date));
    b = res.book;
    bills.push({ id: res.doc.id, pay: payOn });
  };

  const settleDue = (upTo: string) => {
    for (const inv of invoices) {
      const doc = b.docs.find((d) => d.id === inv.id)!;
      if (inv.never || openAmount(doc) <= 0) continue;
      const payDate = addDays(doc.due, inv.delay);
      if (payDate > upTo || payDate > today) continue;
      const bank = doc.currency === "EUR" ? c("bank-eur") : doc.currency === "USD" ? c("bank-usd") : c("bank-try");
      const amount = inv.partial ? Math.round(openAmount(doc) / 2) : openAmount(doc);
      b = recordPayment(b, doc.id, { date: payDate, amount, rate: rate(doc.currency, payDate), account: bank }, at(payDate)).book;
      if (inv.partial) {
        inv.partial = false;
        inv.never = true;
      }
      if (doc.currency !== "TRY") pair(payDate, `Incoming transfer fee · ${doc.number}`, "bank-fees", "bank-try", toMinor(r(90, 180)), doc.number);
    }
    for (const x of bills) {
      const doc = b.docs.find((d) => d.id === x.id)!;
      if (openAmount(doc) <= 0 || x.pay > upTo || x.pay > today) continue;
      const bank = doc.currency === "USD" ? c("bank-usd") : doc.currency === "EUR" ? c("bank-eur") : c("bank-try");
      b = recordPayment(b, doc.id, { date: x.pay, amount: openAmount(doc), rate: rate(doc.currency, x.pay), account: bank }, at(x.pay)).book;
    }
  };

  let lastPayroll: { net: number; sgk: number; tax: number; month: string } | null = null;
  const taxDue: { date: string; amount: number; quarter: string }[] = [];

  for (const [i, m] of months.entries()) {
    const day = (d: number) => `${m}-${String(Math.min(d, Number(monthEnd(m).slice(8)))).padStart(2, "0")}`;
    const end = monthEnd(m);
    const inMonth = (d: string) => d <= today;

    // Last month's salaries, social security and payroll taxes are paid.
    if (lastPayroll && inMonth(day(1))) {
      post(day(1), `Salaries paid · ${lastPayroll.month}`, [
        { account: c("salaries-payable"), debit: lastPayroll.net, credit: 0 },
        { account: c("bank-try"), debit: 0, credit: lastPayroll.net },
      ], "payroll");
    }
    if (lastPayroll && inMonth(day(26))) {
      post(day(26), `SGK premiums and payroll taxes · ${lastPayroll.month}`, [
        { account: c("social-security-payable"), debit: lastPayroll.sgk, credit: 0 },
        { account: c("taxes-payable"), debit: lastPayroll.tax, credit: 0 },
        { account: c("bank-try"), debit: 0, credit: lastPayroll.sgk + lastPayroll.tax },
      ], "payroll");
      lastPayroll = null;
    }

    // Rent and the regular suppliers.
    if (inMonth(day(1))) bill("s-ofis", day(1), [{ description: `Office rent ${m}`, quantity: 1, price: toMinor(56_000), vat: 20, account: c("rent") }], "TRY", `KOG-${m.replace("-", "")}`, day(5));
    if (inMonth(day(3))) bill("s-pixelforge", day(3), [{ description: "Design suite, 6 seats", quantity: 6, price: toMinor(45), vat: 0, account: c("software") }], "USD", `PF-${10_400 + i}`, day(3));
    if (inMonth(day(4))) bill("s-cloudnine", day(4), [{ description: "Hosting and staging servers", quantity: 1, price: toMinor(r(118, 146)), vat: 0, account: c("software") }], "USD", `CN-${88_210 + i * 7}`, day(4));
    if (inMonth(day(8))) bill("s-musavir", day(8), [{ description: "Monthly bookkeeping and payroll", quantity: 1, price: toMinor(12_500), vat: 20, account: c("professional-fees") }], "TRY", `KMM-${2026_100 + i}`, day(18));
    if (inMonth(day(12))) bill("s-telekom", day(12), [{ description: "Fibre internet and phones", quantity: 1, price: toMinor(r(3_100, 3_600)), vat: 20, account: c("office") }], "TRY", `BT-${m.replace("-", "")}-${41 + i}`, day(22));
    if (i % 3 === 1 && inMonth(day(17))) bill("s-seyahat", day(17), [{ description: pick(["Client visit Berlin", "Client visit Paris", "Workshop travel Munich", "Conference trip Lisbon"]), quantity: 1, price: toMinor(r(24_000, 41_000)), vat: 20, account: c("travel") }], "TRY", `AS-${5_000 + i}`, day(24));
    if (i === 3 && inMonth(day(14))) bill("s-bilgi", day(14), [{ description: "Workstations for two new designers", quantity: 2, price: toMinor(84_500), vat: 20, account: c("equipment") }], "TRY", `BTM-${m.replace("-", "")}-07`, day(14));
    if ((i === 5 || i === 9) && inMonth(day(10))) bill("s-ajans", day(10), [{ description: "Portfolio campaign, social ads", quantity: 1, price: toMinor(r(38_000, 52_000)), vat: 20, account: c("marketing") }], "TRY", `KMR-${300 + i}`, day(25));

    // Sales: export work invoiced in euros and dollars (exempt from VAT), local work in lira with 20% VAT.
    const nExport = 2 + Math.floor(rand() * 2);
    for (let k = 0; k < nExport; k++) {
      const d = day(5 + Math.floor(rand() * 20));
      if (!inMonth(d)) continue;
      const party = pick(PARTIES.filter((p) => p.kind === "customer" && p.country !== "TR"));
      const cur = party.currency;
      const lines: DocLine[] = [{ description: pick(SERVICES.export), quantity: 1, price: toMinor(Math.round(r(3_600, 14_500) / 50) * 50), vat: 0, account: c("sales-export") }];
      if (rand() < 0.35) lines.push({ description: "Design hours, additional", quantity: Math.round(r(6, 28)), price: toMinor(cur === "EUR" ? 85 : 95), vat: 0, account: c("sales-export") });
      const res = createDoc(b, { kind: "invoice", number: `KS-${invNo++}`, party: party.id, date: d, due: addDays(d, party.terms), currency: cur, rate: rate(cur, d), lines }, at(d));
      b = res.book;
      const late = party.id === "c-brightwater" ? Math.round(r(10, 40)) : Math.round(r(-8, 12));
      invoices.push({ id: res.doc.id, delay: late, never: party.id === "c-brightwater" && i >= 8 && k === 0, partial: i === 8 && k === 0 && party.id !== "c-brightwater" });
    }
    const nLocal = 1 + Math.floor(rand() * 2);
    for (let k = 0; k < nLocal; k++) {
      const d = day(3 + Math.floor(rand() * 24));
      if (!inMonth(d)) continue;
      const party = pick(PARTIES.filter((p) => p.kind === "customer" && p.country === "TR"));
      const res = createDoc(b, { kind: "invoice", number: `KS-${invNo++}`, party: party.id, date: d, due: addDays(d, party.terms), currency: "TRY", rate: 1, lines: [{ description: pick(SERVICES.domestic), quantity: 1, price: toMinor(Math.round(r(48_000, 210_000) / 500) * 500), vat: 20, account: c("sales-domestic") }] }, at(d));
      b = res.book;
      invoices.push({ id: res.doc.id, delay: Math.round(r(-3, 20)) });
    }

    // Freelance designers and an illustrator who work on the client projects (cost of services).
    if (inMonth(day(24))) bill("s-kolektif", day(24), [{ description: `Freelance design hours ${m}`, quantity: Math.round(r(70, 120)), price: toMinor(1_100), vat: 20, account: c("cost-of-services") }], "TRY", `SDK-${m.replace("-", "")}`, day(28));
    if (i % 2 === 0 && inMonth(day(19))) bill("s-novak", day(19), [{ description: pick(["Editorial illustrations", "Packaging illustrations", "Icon set"]), quantity: 1, price: toMinor(Math.round(r(1_800, 3_600) / 50) * 50), vat: 0, account: c("cost-of-services") }], "EUR", `MN-${2026_040 + i}`, addDays(day(19), 14));

    // Provisional income tax paid this month for an earlier quarter.
    for (const t of taxDue.filter((x) => x.date.startsWith(m) && x.date <= today)) {
      pair(t.date, `Provisional corporate tax paid · ${t.quarter}`, "income-tax-provision", "bank-try", t.amount);
      taxDue.splice(taxDue.indexOf(t), 1);
    }

    // The partners take a dividend once a year.
    if (m.endsWith("-05") && inMonth(day(20))) pair(day(20), "Dividend paid to partners", "retained-earnings", "bank-try", toMinor(400_000));

    if (inMonth(day(15))) topUp(day(15));
    if (inMonth(day(27))) topUp(day(27));

    // Interest on the lira deposit.
    if (inMonth(day(28))) pair(day(28), "Interest on time deposit", "bank-try", "interest-income", toMinor(r(5_800, 9_400)));

    settleDue(end);

    if (end > today) break;

    // Payroll for five people, accrued on the last day and paid on the 1st and 26th.
    const gross = toMinor(i < 4 ? 352_000 : 431_000);
    const employer = Math.round(gross * 0.1575);
    const employeeSgk = Math.round(gross * 0.15);
    const tax = Math.round(gross * 0.118);
    const net = gross - employeeSgk - tax;
    post(end, `Payroll ${m}`, [
      { account: c("salaries"), debit: gross + employer, credit: 0 },
      { account: c("salaries-payable"), debit: 0, credit: net },
      { account: c("social-security-payable"), debit: 0, credit: employeeSgk + employer },
      { account: c("taxes-payable"), debit: 0, credit: tax },
    ], "payroll");
    lastPayroll = { net, sgk: employeeSgk + employer, tax, month: m };

    b = runRecurring(b, end, at(end)).book;
    b = revalue(b, end, at(end)).book;

    // Corporate tax (25%) is provided for at each quarter end and paid on the 17th of the second month after.
    if (["03", "06", "09", "12"].includes(m.slice(5))) {
      const qStart = m.endsWith("-12") && i === 0 ? `${m}-01` : `${addMonths(m, -2)}-01`;
      const profit = incomeStatement(b, qStart < start ? start : qStart, end).beforeTax;
      const amount = Math.max(0, Math.round(profit * 0.25));
      if (amount > 0) {
        pair(end, `Provisional corporate tax ${m.slice(0, 4)} Q${Math.ceil(Number(m.slice(5)) / 3)}`, "income-tax-expense", "income-tax-provision", amount);
        taxDue.push({ date: `${addMonths(m, 2)}-17`, amount, quarter: `${m.slice(0, 4)} Q${Math.ceil(Number(m.slice(5)) / 3)}` });
      }
    }
    b = settleVat(b, m, at(end)).book;
    const vatDue = b.entries.find((e) => e.source === "vat" && e.date === end)?.lines.find((l) => l.account === c("taxes-payable"));
    if (vatDue && vatDue.credit > 0) {
      const payDay = `${addMonths(m, 1)}-26`;
      if (payDay <= today) post(payDay, `VAT paid · ${m}`, [
        { account: c("taxes-payable"), debit: vatDue.credit, credit: 0 },
        { account: c("bank-try"), debit: 0, credit: vatDue.credit },
      ], "vat");
    }

    // The first month of the window ends a calendar year: close it.
    if (m.endsWith("-12")) b = closeYear(b, Number(m.slice(0, 4)), at(end)).book;
  }
  settleDue(today);

  // Last month but one is reviewed and locked.
  const lockMonth = addMonths(today.slice(0, 7), -2);
  const lockDate = monthEnd(lockMonth);
  if (!b.lockedThrough || b.lockedThrough < lockDate) b = lockThrough(b, lockDate);

  // Two drafts waiting for review: one balanced, one still missing its other side.
  const d1 = addDays(today, -1) > `${today.slice(0, 7)}-01` ? addDays(today, -1) : today;
  b = saveDraft(b, {
    date: d1,
    memo: "Client dinner, Nordlicht kickoff",
    ref: "RCPT-0412",
    lines: [
      { account: c("marketing"), debit: toMinor(6_840), credit: 0 },
      { account: c("vat-input"), debit: toMinor(684), credit: 0 },
      { account: c("cash"), debit: 0, credit: toMinor(7_524) },
    ],
  }).book;
  b = saveDraft(b, {
    date: today,
    memo: "Prepaid annual font licence",
    lines: [{ account: c("prepaid"), debit: toMinor(18_400), credit: 0 }],
  }).book;

  return { ...b, audit: b.audit.slice(0, 400) };
}
