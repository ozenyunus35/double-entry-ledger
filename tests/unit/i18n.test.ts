import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BUCKETS } from "@/lib/docs";
import { SOURCE, TYPE } from "@/lib/export";
import { misses, translate } from "@/lib/i18n";
import { balanceSheet, cashFlow, incomeStatement } from "@/lib/reports";
import { demoBook } from "@/lib/seed";
import { TR } from "@/lib/tr";

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(f) ? [p] : [];
  });
}

const sources = files("src").map((f) => [f, readFileSync(f, "utf8")] as const);
const lit = (s: string) => JSON.parse(`"${s}"`) as string;

describe("Turkish interface", () => {
  it("has a translation for every literal passed to t()", () => {
    const keys = new Set<string>();
    for (const [, src] of sources) {
      for (const m of src.matchAll(/\bt\(\s*"((?:[^"\\]|\\.)*)"/g)) keys.add(lit(m[1]));
      for (const m of src.matchAll(/\bt\([^()"]*?\?\s*"((?:[^"\\]|\\.)*)"\s*:\s*"((?:[^"\\]|\\.)*)"/g)) {
        keys.add(lit(m[1]));
        keys.add(lit(m[2]));
      }
    }
    const missing = [...keys].filter((k) => TR[k] === undefined);
    expect(missing).toEqual([]);
    expect(keys.size).toBeGreaterThan(300);
  });

  it("translates every message the ledger rules can show", () => {
    const keys = new Set<string>();
    for (const [f, src] of sources) {
      if (!f.includes("/lib/")) continue;
      for (const m of src.matchAll(/\bmessage:\s*"((?:[^"\\]|\\.)*)"/g)) keys.add(lit(m[1]));
      for (const m of src.matchAll(/new LedgerError\(\s*"[^"]+",\s*"((?:[^"\\]|\\.)*)"/g)) keys.add(lit(m[1]));
    }
    for (const [f, src] of sources) {
      if (!f.includes("/components/")) continue;
      for (const m of src.matchAll(/new LedgerError\(\s*"[^"]+",\s*"((?:[^"\\]|\\.)*)"/g)) keys.add(lit(m[1]));
    }
    expect([...keys].filter((k) => TR[k] === undefined)).toEqual([]);
    expect(keys.size).toBeGreaterThan(50);
  });

  it("translates the label tables and statement lines", () => {
    const b = demoBook("tdhp", "2026-11-06");
    const labels = [
      ...Object.values(SOURCE),
      ...Object.values(TYPE),
      ...BUCKETS,
      ...incomeStatement(b, "2026-01-01", "2026-11-06").lines.map((l) => l.label),
      ...cashFlow(b, "2026-01-01", "2026-11-06").lines.map((l) => l.label),
      ...(() => {
        const bs = balanceSheet(b, "2026-11-06");
        return [...bs.assets, ...bs.liabilities, ...bs.equity].map((l) => l.label);
      })(),
    ];
    for (const [f, src] of sources) {
      if (!/app\.tsx|accounts\.tsx|documents\.tsx|audit\.tsx|entry-editor\.tsx|reports\.tsx/.test(f)) continue;
      for (const m of src.matchAll(/\blabel:\s*"((?:[^"\\]|\\.)*)"/g)) labels.push(lit(m[1]));
      for (const block of src.matchAll(/(?:LABEL|PLURAL|ACTION)\b[^=\n]*=\s*\{([\s\S]*?)\};/g)) for (const m of block[1].matchAll(/:\s*\[?"((?:[^"\\]|\\.)*)"/g)) labels.push(lit(m[1]));
    }
    expect([...new Set(labels)].filter((k) => k && TR[k] === undefined)).toEqual([]);
  });

  it("translates every description and log line the demo books show", () => {
    for (const chart of ["tdhp", "intl"] as const) {
      const b = demoBook(chart, "2026-11-06");
      misses.clear();
      for (const e of b.entries) translate("tr", e.memo);
      for (const a of b.audit) translate("tr", a.target.replace(/^#\d+ /, ""));
      for (const r of b.recurring) translate("tr", r.name);
      expect([...misses]).toEqual([]);
    }
  });

  it("keeps numbers and names when it translates sentences built in code", () => {
    expect(translate("tr", "Invoice KS-241 · Lumen & Ash Studio")).toBe("KS-241 faturası · Lumen & Ash Studio");
    expect(translate("tr", "Reversal of #12: Payroll 2026-03")).toBe("#12 ters kaydı: Bordro 2026-03");
    expect(translate("tr", "Salaries paid · 2026-10")).toBe("Maaşlar ödendi · 2026-10");
    expect(translate("tr", "Month-end FX revaluation")).toBe("Ay sonu kur değerlemesi");
    expect(translate("tr", "Line {n} has no account.", { n: 3 })).toBe("3. satırda hesap yok.");
    expect(translate("en", "Line {n} has no account.", { n: 3 })).toBe("Line 3 has no account.");
  });
});
