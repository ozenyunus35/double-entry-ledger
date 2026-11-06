import type { ChartId } from "./charts";
import { addMonths } from "./ledger";
import { demoBook } from "./seed";
import type { Book } from "./types";

/**
 * The books live in this browser. Demo books nobody has changed are rebuilt each day so their last twelve
 * months end today; once a visitor posts anything, their copy is kept as it is.
 */

const KEY = "folio:books:v1";
const EVENT = "folio:books";

export interface State {
  books: Book[];
  active: string;
  /** Books changed by the user; untouched demo books are not stored, only rebuilt. */
  edited: string[];
  today: string;
}

let state: State | null = null;

export function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const DEMOS: ChartId[] = ["tdhp", "intl"];

function load(): State {
  const today = localToday();
  let saved: { books?: Book[]; active?: string; edited?: string[] } = {};
  try {
    saved = JSON.parse(localStorage.getItem(KEY) ?? "{}");
  } catch {
    saved = {};
  }
  const edited = (saved.edited ?? []).filter((id) => saved.books?.some((b) => b.id === id));
  const kept = (saved.books ?? []).filter((b) => b && Array.isArray(b.entries) && Array.isArray(b.accounts) && (edited.includes(b.id) || !b.demo));
  const books: Book[] = [];
  for (const chart of DEMOS) {
    const id = `demo-${chart}`;
    books.push(kept.find((b) => b.id === id) ?? demoBook(chart, today));
  }
  books.push(...kept.filter((b) => !b.id.startsWith("demo-")));
  let active = saved.active && books.some((b) => b.id === saved.active) ? saved.active : "";
  if (!active) {
    const tr = typeof navigator !== "undefined" && /^tr\b/i.test(navigator.language);
    active = tr ? "demo-tdhp" : "demo-intl";
  }
  return { books, active, edited, today };
}

function save(s: State) {
  try {
    const books = s.books.filter((b) => s.edited.includes(b.id) || !b.demo);
    localStorage.setItem(KEY, JSON.stringify({ books, active: s.active, edited: s.edited }));
  } catch {
    // Storage full or blocked: the session keeps working, it just isn't kept.
  }
}

export function getState(): State {
  if (!state) state = load();
  return state;
}

export const getServerState = (): State | null => null;

export function subscribe(cb: () => void) {
  window.addEventListener(EVENT, cb);
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) {
      state = load();
      cb();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(EVENT, cb);
    window.removeEventListener("storage", onStorage);
  };
}

function set(next: State) {
  state = next;
  save(next);
  window.dispatchEvent(new Event(EVENT));
}

export const activeBook = (s: State) => s.books.find((b) => b.id === s.active) ?? s.books[0];

/**
 * Applies a change to the active book. Ledger rules throw a LedgerError and nothing is saved; callers show it.
 * Results are passed out through the closure: `let e; update((b) => { const r = postEntry(b, x); e = r.entry; return r.book; })`.
 */
export function update(fn: (b: Book) => Book) {
  const s = getState();
  const book = activeBook(s);
  const next = fn(book);
  set({ ...s, books: s.books.map((b) => (b.id === book.id ? next : b)), edited: s.edited.includes(book.id) ? s.edited : [...s.edited, book.id] });
}

export function setActive(id: string) {
  const s = getState();
  if (s.books.some((b) => b.id === id)) set({ ...s, active: id });
}

export function addBook(book: Book) {
  const s = getState();
  set({ ...s, books: [...s.books, book], active: book.id, edited: [...s.edited, book.id] });
}

export function removeBook(id: string) {
  const s = getState();
  if (id.startsWith("demo-")) return;
  const books = s.books.filter((b) => b.id !== id);
  set({ ...s, books, active: s.active === id ? books[0].id : s.active, edited: s.edited.filter((x) => x !== id) });
}

/** Rebuilds a demo book from scratch, dropping the visitor's changes to it. */
export function resetDemo(id: string) {
  const s = getState();
  const chart = id.replace("demo-", "") as ChartId;
  const fresh = demoBook(chart, s.today);
  set({ ...s, books: s.books.map((b) => (b.id === id ? fresh : b)), edited: s.edited.filter((x) => x !== id) });
}

/** A default reporting period: the year to date. */
export const yearToDate = (today: string) => ({ from: `${today.slice(0, 4)}-01-01`, to: today });

export const lastMonths = (today: string, n: number) => Array.from({ length: n }, (_, i) => addMonths(today.slice(0, 7), i - n + 1));
