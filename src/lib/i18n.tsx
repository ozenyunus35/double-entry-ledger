"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useSyncExternalStore } from "react";
import { setFormatLocale } from "./format";
import { TR } from "./tr";

export type Lang = "en" | "tr";
export type Vars = Record<string, string | number>;

const KEY = "folio:lang";
const EVENT = "folio:lang";

const fill = (s: string, vars?: Vars) => (vars ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : s);
const escape = (s: string) => s.replace(/[.*+?^$()|[\]\\]/g, "\\$&");

/**
 * English text is the key. Keys with {placeholders} also translate sentences built in code
 * ("Items sum to 480.00, document says 485.00"): the placeholders match any text, and the
 * captured parts are translated again, so "Missing: vendor, date" becomes "Eksik: satıcı, tarih".
 */
const PATTERNS = Object.keys(TR)
  .filter((k) => /\{\w+\}/.test(k))
  .map((key) => {
    const parts = key.split(/\{(\w+)\}/);
    const names = parts.filter((_, i) => i % 2 === 1);
    const re = new RegExp(`^${parts.map((p, i) => (i % 2 ? "(.+?)" : escape(p))).join("")}$`, "s");
    const literal = parts.filter((_, i) => i % 2 === 0).join("").length;
    return { key, names, re, literal };
  })
  .sort((a, b) => b.literal - a.literal);

/** Strings that reached the translator without a Turkish version; the e2e suite asserts this stays empty. */
export const misses = new Set<string>();

export function translate(lang: Lang, s: string, vars?: Vars): string {
  if (lang === "en" || !s) return fill(s, vars);
  const done = vars ? (TR[s] ?? null) : tryTranslate(s, 0);
  if (done !== null) return fill(done, vars);
  misses.add(s);
  if (process.env.NODE_ENV !== "production") console.warn(`[i18n] missing tr: ${s}`);
  return fill(s, vars);
}

/** Like translate, for text that may also be data (sheet names, document titles): unknown text passes through quietly. */
export function translateKnown(lang: Lang, s: string): string {
  return lang === "en" || !s ? s : (tryTranslate(s, 0) ?? s);
}

/** Turkish for a whole string, or null when some part of it has no translation. */
function tryTranslate(s: string, depth: number): string | null {
  const exact = TR[s];
  if (exact !== undefined) return exact;
  if (!/\p{L}/u.test(s)) return s;
  if (depth > 4) return null;
  for (const sep of ["; ", " · "]) {
    if (!s.includes(sep)) continue;
    const parts = s.split(sep).map((x) => tryTranslate(x, depth + 1));
    if (parts.every((x) => x !== null)) return parts.join(sep);
  }
  for (const p of PATTERNS) {
    const m = p.re.exec(s);
    if (!m) continue;
    const got: Vars = {};
    p.names.forEach((n, i) => (got[n] = translatePart(m[i + 1], depth)));
    return fill(TR[p.key], got);
  }
  return null;
}

/** A captured part: words and lists of words are translated, numbers and names stay as they are. */
function translatePart(s: string, depth: number): string {
  const whole = tryTranslate(s, depth + 1);
  if (whole !== null) return whole;
  if (s.includes(", ")) {
    const items = s.split(", ").map((x) => tryTranslate(x, depth + 1));
    if (items.every((x) => x !== null)) return items.join(", ");
  }
  return s;
}

function readLang(): Lang {
  try {
    const q = new URLSearchParams(location.search).get("lang");
    if (q === "tr" || q === "en") return q;
    const saved = localStorage.getItem(KEY);
    if (saved === "tr" || saved === "en") return saved;
  } catch {}
  return typeof navigator !== "undefined" && /^tr\b/i.test(navigator.language) ? "tr" : "en";
}

function subscribe(cb: () => void) {
  window.addEventListener(EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}

type Ctx = { lang: Lang; setLang: (l: Lang) => void; t: (s: string, vars?: Vars) => string };
const LangContext = createContext<Ctx>({ lang: "en", setLang: () => {}, t: (s, v) => fill(s, v) });

export function LangProvider({ children }: { children: React.ReactNode }) {
  const lang = useSyncExternalStore(subscribe, readLang, () => "en" as Lang);
  setFormatLocale(lang);
  const setLang = useCallback((l: Lang) => {
    try {
      localStorage.setItem(KEY, l);
      const url = new URL(location.href);
      if (url.searchParams.has("lang")) {
        url.searchParams.delete("lang");
        history.replaceState(history.state, "", url);
      }
    } catch {}
    window.dispatchEvent(new Event(EVENT));
  }, []);
  useEffect(() => {
    document.documentElement.lang = lang;
    // Read by the end-to-end tests: text shown in Turkish without a translation.
    (window as unknown as { __i18nMisses: Set<string> }).__i18nMisses = misses;
    // A link with ?lang=tr keeps the visitor in Turkish after they move around.
    try {
      const q = new URLSearchParams(location.search).get("lang");
      if (q === "tr" || q === "en") localStorage.setItem(KEY, q);
    } catch {}
  }, [lang]);
  const value = useMemo<Ctx>(() => ({ lang, setLang, t: (s, vars) => translate(lang, s, vars) }), [lang, setLang]);
  return <LangContext.Provider value={value}>{children}</LangContext.Provider>;
}

export const useLang = () => useContext(LangContext);
export const useT = () => useContext(LangContext).t;

/** TR | EN switch for the header. */
export function LangToggle({ className = "" }: { className?: string }) {
  const { lang, setLang } = useLang();
  return (
    <div className={`inline-flex rounded-md border border-border p-0.5 text-[11px] font-medium ${className}`} role="radiogroup" aria-label={lang === "tr" ? "Dil" : "Language"}>
      {(["en", "tr"] as const).map((l) => (
        <button
          key={l}
          role="radio"
          data-lang={l}
          aria-checked={lang === l}
          onClick={() => setLang(l)}
          className={`rounded px-1.5 py-0.5 uppercase transition-colors ${lang === l ? "bg-surface-2 text-text" : "text-faint hover:text-text"}`}
        >
          {l}
        </button>
      ))}
    </div>
  );
}

/** For text that may also be data, such as entry descriptions: known phrases are translated, the rest is shown as written. */
export function useKnown() {
  const { lang } = useLang();
  return (s: string) => translateKnown(lang, s);
}
