const formatters = new Map<string, Intl.NumberFormat>();
let locale = "en-US";
let lang: "en" | "tr" = "en";

/** The interface language, for code outside React such as the Excel export. */
export const uiLang = () => lang;
export const uiLocale = () => locale;

/** Follows the interface language: 1,234.50 in English, 1.234,50 in Turkish. */
export function setFormatLocale(next: "en" | "tr") {
  lang = next;
  locale = next === "tr" ? "tr-TR" : "en-US";
}

function nf(key: string, make: () => Intl.NumberFormat) {
  let f = formatters.get(key);
  if (!f) formatters.set(key, (f = make()));
  return f;
}

/** Minor units as a plain amount: 123456 → "1,234.56" or "1.234,56". */
export function amount(minor: number): string {
  return nf(`${locale}|n2`, () => new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })).format(minor / 100);
}

/** Minor units with the currency: "₺1,234.56", "€1.234,56". */
export function money(minor: number, currency = "TRY"): string {
  return nf(`${locale}|${currency}`, () => new Intl.NumberFormat(locale, { style: "currency", currency, currencyDisplay: "narrowSymbol", minimumFractionDigits: 2 })).format(minor / 100);
}

/** Short form for charts and cards: ₺1.2M, ₺845K (English) or ₺1,2 Mn, ₺845 B (Turkish). */
export function compact(minor: number, currency = "TRY"): string {
  return nf(`${locale}|c|${currency}`, () => new Intl.NumberFormat(locale, { style: "currency", currency, currencyDisplay: "narrowSymbol", notation: "compact", maximumFractionDigits: 1 })).format(minor / 100);
}

/** Debit/credit cells show nothing for zero, so the side that carries the amount stands out. */
export const cell = (minor: number) => (minor ? amount(minor) : "");

/** Accounting style: negatives in parentheses. */
export const acct = (minor: number) => (minor < 0 ? `(${amount(-minor)})` : amount(minor));

export function date(iso: string | null | undefined): string {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

export function shortDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(locale, { day: "numeric", month: "short", timeZone: "UTC" });
}

export function monthName(ym: string, style: "long" | "short" = "long"): string {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString(locale, { month: style, year: "numeric", timeZone: "UTC" });
}

/** 12% in English, %12 in Turkish. */
export const percent = (n: number) => (lang === "tr" ? `${n < 0 ? "-" : ""}%${Math.abs(n)}` : `${n}%`);

export const rate = (n: number) => n.toLocaleString(locale, { minimumFractionDigits: 4, maximumFractionDigits: 4 });

export const fxAmount = (minor: number, currency: string) => money(minor, currency);

/** An amount typed in a form, in either style, to minor units; null when it isn't a number. */
export { parseAmount as parseTyped } from "./money";
