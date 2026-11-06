import { describe, expect, it } from "vitest";
import { detectOrder, parseDate } from "@/lib/dates";
import { createDoc } from "@/lib/docs";
import { bankEntries, decodeBytes, guessJournalColumns, matchAccount, parseCsv, postImport, readBank, readJournal, sampleJournalCsv } from "@/lib/importer";
import { balances, code, postEntry } from "@/lib/ledger";
import { demoBook, emptyBook } from "@/lib/seed";
import type { Book } from "@/lib/types";

const book = (): Book => ({ ...emptyBook("tdhp", "Import test"), parties: [{ id: "c1", name: "Moda Kahve", kind: "customer", country: "TR", currency: "TRY", terms: 15 }] });
const codes = (imp: ReturnType<typeof readJournal>) => imp.entries.map((e) => e.issues.map((i) => i.code));

describe("dates", () => {
  it.each([
    ["2026-01-31", "2026-01-31"],
    ["31.01.2026", "2026-01-31"],
    ["31/01/26", "2026-01-31"],
    ["1.2.2026", "2026-02-01"],
    ["31 Oca 2026", "2026-01-31"],
    ["31 Ocak 2026", "2026-01-31"],
    ["3 Şubat 2026", "2026-02-03"],
    ["Jan 31, 2026", "2026-01-31"],
    ["31-Jan-2026", "2026-01-31"],
    ["2026-01-31 14:05:00", "2026-01-31"],
    ["46053", "2026-01-31"],
  ])("reads %s", (s, want) => expect(parseDate(s)).toBe(want));
  it.each(["31.02.2026", "2026-13-01", "yesterday", "", "12345", "32/01/2026"])("rejects %j", (s) => expect(parseDate(s)).toBeNull());
  it("works out month-first files from the values that can't be day-first", () => {
    expect(detectOrder(["01/31/2026", "02/03/2026"])).toBe("mdy");
    expect(parseDate("02/03/2026", "mdy")).toBe("2026-02-03");
    expect(detectOrder(["31/01/2026", "02/03/2026"])).toBe("dmy");
  });
});

describe("CSV", () => {
  it("detects the delimiter and keeps quoted delimiters, doubled quotes and line breaks", () => {
    const { rows, delimiter } = parseCsv('Date;Account;Description;Debit\r\n01.02.2026;102.01;"Rent; February ""office""";1.000,00\r\n\r\n02.02.2026;600;"two\nlines";5,00\n');
    expect(delimiter).toBe(";");
    expect(rows).toEqual([
      ["Date", "Account", "Description", "Debit"],
      ["01.02.2026", "102.01", 'Rent; February "office"', "1.000,00"],
      ["02.02.2026", "600", "two\nlines", "5,00"],
    ]);
  });
  it("reads tabs, and Windows-1254 bytes from Turkish Excel", () => {
    expect(parseCsv("a\tb\tc\n1\t2\t3").delimiter).toBe("\t");
    const bytes = new Uint8Array([0x41, 0xe7, 0xfd, 0x6b, 0xfe]); // "Açıkş" in windows-1254
    expect(decodeBytes(bytes)).toBe("Açıkş");
    expect(decodeBytes(new TextEncoder().encode("﻿Tarih;Açıklama"))).toBe("Tarih;Açıklama");
  });
  it("guesses Turkish and English headers", () => {
    expect(guessJournalColumns(["Fiş No", "Tarih", "Hesap Kodu", "Açıklama", "Borç", "Alacak"])).toEqual({ entry: 0, date: 1, account: 2, description: 3, debit: 4, credit: 5 });
    expect(guessJournalColumns(["JE No", "Posting Date", "GL Account", "Memo", "Amount", "Currency", "FX Amount", "Rate"])).toMatchObject({ entry: 0, date: 1, account: 2, description: 3, amount: 4, currency: 5, fx: 6, rate: 7 });
  });
});

describe("account matching", () => {
  const b = book();
  it.each([
    ["102.01", "102.01"],
    ["10201", "102.01"],
    ["102 01", "102.01"],
    ["102.01 Bankalar · TRY", "102.01"],
    ["Kasa", "100"],
    ["kira giderleri", "770.02"],
    ["Rent", "770.02"],
    ["600", "600"],
  ])("finds %s", (raw, want) => expect(matchAccount(b.accounts, raw)?.code).toBe(want));
  it.each(["999", "Bank", ""])("doesn't guess %j", (raw) => expect(matchAccount(b.accounts, raw)).toBeNull());
});

describe("journal import", () => {
  it("imports the sample file and posts balanced entries", () => {
    const b = book();
    const imp = readJournal(b, parseCsv(sampleJournalCsv(b)).rows);
    expect(imp.entries).toHaveLength(2);
    expect(codes(imp)).toEqual([[], []]);
    const res = postImport(b, imp);
    expect(res.posted).toHaveLength(2);
    expect(balances(res.book).get("100")?.credit).toBe(150000);
  });

  it("groups by balance when there is no entry column, with signed amounts and month-first dates", () => {
    const b = book();
    const csv = ["Date,Account,Memo,Amount", "01/31/2026,770.02,Rent,\"56,000.00\"", "01/31/2026,102.01,Rent,\"-56,000.00\"", "02/15/2026,102.01,Sale,1200", "02/15/2026,600,Sale,-1200"].join("\n");
    const imp = readJournal(b, parseCsv(csv).rows);
    expect(imp.order).toBe("mdy");
    expect(imp.entries.map((e) => [e.date, e.lines.length, e.issues.length])).toEqual([["2026-01-31", 2, 0], ["2026-02-15", 2, 0]]);
  });

  it("reports what is wrong with each entry and posts only the good ones", () => {
    let b = book();
    b = postEntry(b, { date: "2026-01-05", memo: "x", lines: [{ account: "102.01", debit: 100, credit: 0 }, { account: "600", debit: 0, credit: 100 }] }).book;
    b = { ...b, lockedThrough: "2026-01-31" };
    const csv = [
      "Fiş No;Tarih;Hesap;Açıklama;Borç;Alacak",
      "1;15.01.2026;102.01;Locked month;100,00;",
      "1;15.01.2026;600;Locked month;;100,00",
      "2;10.02.2026;999;Unknown account;50,00;",
      "2;10.02.2026;600;Unknown account;;50,00",
      "3;11.02.2026;102.01;Off by one kuruş;100,00;",
      "3;11.02.2026;600;Off by one kuruş;;99,99",
      "4;12.02.2026;102;Heading;10,00;",
      "4;12.02.2026;600;Heading;;10,00",
      "5;30.02.2026;102.01;Bad date;10,00;",
      "5;30.02.2026;600;Bad date;;10,00",
      "6;13.02.2026;102.01;Two dates;10,00;",
      "6;14.02.2026;600;Two dates;;10,00",
      "7;15.02.2026;102.01;Not a number;on bin;",
      "7;15.02.2026;600;Not a number;;10,00",
      "8;16.02.2026;102.01;Good;1.234,56;",
      "8;16.02.2026;600;Good;;1.234,56",
    ].join("\n");
    const imp = readJournal(b, parseCsv(csv).rows);
    expect(codes(imp)).toEqual([["locked"], ["row-account"], ["unbalanced"], ["row-header"], ["row-date", "row-date"], ["mixed-dates"], ["row-amount"], []]);
    const res = postImport(b, imp);
    expect(res.posted).toHaveLength(1);
    expect(res.posted[0].lines[0].debit).toBe(123456);
  });

  it("explains a file it can't use instead of guessing", () => {
    const b = book();
    expect(readJournal(b, parseCsv("Tarih;Açıklama\n01.01.2026;x").rows).fileIssues.map((i) => i.code)).toEqual(["no-account-column", "no-amount-columns"]);
    expect(readJournal(b, parseCsv("Date;Account;Debit;Credit").rows).fileIssues.map((i) => i.code)).toEqual(["empty-file"]);
    expect(readJournal(b, []).fileIssues.map((i) => i.code)).toEqual(["empty-file"]);
  });

  it("imports foreign currency lines with their rate", () => {
    const b = { ...book(), lockedThrough: null };
    const csv = ["Entry,Date,Account,Debit,Credit,Currency,FX Amount,Rate", "A,2026-03-01,102.02,5012.34,,EUR,100.00,50.1234", "A,2026-03-01,601,,5012.34,,,"].join("\n");
    const imp = readJournal(b, parseCsv(csv).rows);
    expect(codes(imp)).toEqual([[]]);
    expect(imp.entries[0].lines[0]).toMatchObject({ currency: "EUR", fx: 10000, rate: 50.1234 });
  });

  it("survives random junk without throwing", () => {
    const b = book();
    let seed = 7;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const junk = "abc;,\t\"'0123456789.-₺€ \nçğışöü";
    for (let n = 0; n < 200; n++) {
      let s = "Date;Account;Debit;Credit\n";
      for (let k = 0; k < 40; k++) s += junk[Math.floor(rand() * junk.length)];
      expect(() => readJournal(b, parseCsv(s).rows)).not.toThrow();
    }
  });
});

describe("bank import", () => {
  it("matches a payment to the open invoice it settles and suggests accounts from the words", () => {
    let b = book();
    b = createDoc(b, { kind: "invoice", number: "KS-1", party: "c1", date: "2026-02-01", due: "2026-02-16", currency: "TRY", rate: 1, lines: [{ description: "Menu design", quantity: 1, price: 1_000_000, vat: 20, account: "600" }] }).book;
    const csv = ["Tarih;Açıklama;Tutar;Bakiye", "16.02.2026;EFT MODA KAHVE KS-1;12.000,00;50.000,00", "17.02.2026;Şubat kira ödemesi;-56.000,00;0,00", "18.02.2026;EFT ücreti;-12,50;0,00", "19.02.2026;Mevduat faizi;845,20;0,00", "20.02.2026;Bilinmeyen havale;300,00;0,00"].join("\n");
    const { rows } = readBank(b, "102.01", parseCsv(csv).rows);
    expect(rows.map((r) => [r.amount, r.suggestion, !!r.doc])).toEqual([
      [1200000, "receivables", true],
      [-5600000, "rent", false],
      [-1250, "bank-fees", false],
      [84520, "interest-income", false],
      [30000, null, false],
    ]);
    const entries = bankEntries("102.01", rows);
    expect(entries).toHaveLength(3);
    let bb = b;
    for (const e of entries) bb = postEntry(bb, { ...e, source: "import" }).book;
    const again = readBank(bb, "102.01", parseCsv(csv).rows);
    expect(again.rows.filter((r) => r.duplicate)).toHaveLength(3);
  });

  it("reads separate in and out columns in an English export", () => {
    const b = book();
    const csv = ["Date,Description,Money In,Money Out,Balance", '03/02/2026,Interest,"1,000.00",,', "03/03/2026,Bank charge,,2.50,"].join("\n");
    const res = readBank(b, "102.01", parseCsv(csv).rows);
    expect(res.fileIssues).toEqual([]);
  });

  it("asks for the columns it needs", () => {
    expect(readBank(book(), "102.01", parseCsv("When;What\n1;2").rows).fileIssues.map((i) => i.code)).toEqual(["no-date-column", "no-bank-amount"]);
  });
});

it("imports into the demo books without breaking the trial balance", () => {
  const b = demoBook("intl", "2026-11-06");
  const imp = readJournal(b, parseCsv(sampleJournalCsv(b)).rows);
  const res = postImport(b, imp);
  const all = balances(res.book);
  let net = 0;
  for (const x of all.values()) net += x.debit - x.credit;
  expect(net).toBe(0);
  expect(res.posted).toHaveLength(2);
  expect(code(b, "cash")).toBe("1000");
});
