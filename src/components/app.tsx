"use client";

import {
  ArrowLeftRight,
  BarChart3,
  BookOpen,
  Building2,
  Check as CheckIcon,
  ChevronDown,
  FileInput,
  FileText,
  History,
  LayoutDashboard,
  Link2,
  ListTree,
  Lock,
  Menu,
  Plus,
  Receipt,
  RotateCcw,
  Rows3,
  Search,
  Upload,
} from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { LangProvider, LangToggle, translateKnown, useLang, useT } from "@/lib/i18n";
import { LedgerError } from "@/lib/ledger";
import { go, shareUrl, useRoute, type Route, type View } from "@/lib/route";
import { activeBook, getServerState, getState, resetDemo, setActive, subscribe, update, yearToDate, type State } from "@/lib/store";
import type { Book, Entry } from "@/lib/types";
import { addMonths, monthEnd } from "@/lib/ledger";
import { date as fmtDate } from "@/lib/format";
import { Palette, usePaletteShortcut, type Command } from "./palette";
import { ThemeToggle, toggleTheme } from "./theme-toggle";
import { ToastProvider, useToast } from "./toast";
import { Button, Spinner, cx } from "./ui";
import { FolioMark } from "./brand";
import { EntryEditor } from "./entry-editor";
import { Overview } from "./views/overview";
import { Journal } from "./views/journal";
import { Ledger } from "./views/ledger";
import { Accounts } from "./views/accounts";
import { Documents } from "./views/documents";
import { Reports } from "./views/reports";
import { Currencies } from "./views/currencies";
import { Close } from "./views/close";
import { Import } from "./views/import";
import { Audit } from "./views/audit";
import { NewBook } from "./new-book";

interface Ctx {
  state: State;
  book: Book;
  today: string;
  period: { from: string; to: string };
  /** Runs a change to the books; a broken rule shows as a message and nothing changes. Returns whether it worked. */
  act: (fn: (b: Book) => Book, success?: string) => boolean;
  edit: (entry?: Entry | null, preset?: Partial<Entry>) => void;
}

const BookContext = createContext<Ctx | null>(null);
export const useBook = () => {
  const c = useContext(BookContext);
  if (!c) throw new Error("useBook outside the app");
  return c;
};

export const NAV: { v: View; label: string; icon: React.ComponentType<{ className?: string }>; group: string }[] = [
  { v: "overview", label: "Overview", icon: LayoutDashboard, group: "Books" },
  { v: "journal", label: "Journal", icon: BookOpen, group: "Books" },
  { v: "ledger", label: "General ledger", icon: Rows3, group: "Books" },
  { v: "accounts", label: "Chart of accounts", icon: ListTree, group: "Books" },
  { v: "sales", label: "Sales invoices", icon: FileText, group: "Business" },
  { v: "purchases", label: "Bills", icon: Receipt, group: "Business" },
  { v: "reports", label: "Reports", icon: BarChart3, group: "Business" },
  { v: "currencies", label: "Currencies", icon: ArrowLeftRight, group: "Period end" },
  { v: "close", label: "Close and VAT", icon: Lock, group: "Period end" },
  { v: "import", label: "Import", icon: Upload, group: "Period end" },
  { v: "audit", label: "Audit log", icon: History, group: "Period end" },
];

export function App() {
  return (
    <LangProvider>
      <ToastProvider>
        <Shell />
      </ToastProvider>
    </LangProvider>
  );
}

export const PRESETS = ["month", "last-month", "quarter", "ytd", "last-year", "12m"] as const;
export type Preset = (typeof PRESETS)[number];

export function presetRange(p: Preset, today: string): { from: string; to: string } {
  const ym = today.slice(0, 7);
  const y = Number(today.slice(0, 4));
  switch (p) {
    case "month":
      return { from: `${ym}-01`, to: today };
    case "last-month": {
      const m = addMonths(ym, -1);
      return { from: `${m}-01`, to: monthEnd(m) };
    }
    case "quarter": {
      const q = Math.floor((Number(today.slice(5, 7)) - 1) / 3) * 3 + 1;
      return { from: `${y}-${String(q).padStart(2, "0")}-01`, to: today };
    }
    case "ytd":
      return yearToDate(today);
    case "last-year":
      return { from: `${y - 1}-01-01`, to: `${y - 1}-12-31` };
    case "12m":
      return { from: `${addMonths(ym, -11)}-01`, to: today };
  }
}

export const PRESET_LABEL: Record<Preset, string> = {
  month: "This month",
  "last-month": "Last month",
  quarter: "This quarter",
  ytd: "Year to date",
  "last-year": "Last year",
  "12m": "Last 12 months",
};

function Shell() {
  const state = useSyncExternalStore(subscribe, getState, getServerState);
  const t = useT();
  if (!state) return <Spinner label={t("Opening the books")} />;
  return <Loaded state={state} />;
}

function Loaded({ state }: { state: State }) {
  const t = useT();
  const { lang } = useLang();
  const { toast } = useToast();
  const route = useRoute();
  const book = activeBook(state);
  const today = state.today;
  const period = useMemo(() => {
    const ytd = yearToDate(today);
    return { from: route.from ?? ytd.from, to: route.to ?? ytd.to };
  }, [route.from, route.to, today]);
  const [editor, setEditor] = useState<{ entry: Entry | null; preset?: Partial<Entry> } | null>(null);
  const [menu, setMenu] = useState(false);
  const [palette, setPalette] = useState(false);
  const [newBook, setNewBook] = useState(false);

  const act = useCallback(
    (fn: (b: Book) => Book, success?: string) => {
      try {
        update(fn);
        if (success) toast(success);
        return true;
      } catch (e) {
        if (e instanceof LedgerError) {
          toast(t(e.message, e.vars), "error");
          return false;
        }
        throw e;
      }
    },
    [toast, t],
  );
  const edit = useCallback((entry?: Entry | null, preset?: Partial<Entry>) => setEditor({ entry: entry ?? null, preset }), []);
  const ctx = useMemo<Ctx>(() => ({ state, book, today, period, act, edit }), [state, book, today, period, act, edit]);

  const openPalette = useCallback(() => setPalette(true), []);
  usePaletteShortcut(openPalette);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest("input, textarea, select, [contenteditable], dialog")) return;
      if (e.key === "n" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        edit(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [edit]);

  const commands = useMemo<Command[]>(() => {
    const goTo = t("Go to");
    const list: Command[] = NAV.map((n) => ({ id: `v:${n.v}`, label: t(n.label), group: goTo, icon: n.icon, run: () => go({ v: n.v }) }));
    const actions = t("Actions");
    list.push(
      { id: "new-entry", label: t("New journal entry"), group: actions, icon: Plus, hint: "N", run: () => edit(null) },
      { id: "new-invoice", label: t("New sales invoice"), group: actions, icon: FileText, run: () => go({ v: "sales", d: "new" }) },
      { id: "new-bill", label: t("New bill"), group: actions, icon: Receipt, run: () => go({ v: "purchases", d: "new" }) },
      { id: "import", label: t("Import a CSV file"), group: actions, icon: FileInput, run: () => go({ v: "import" }) },
      { id: "copy-link", label: t("Copy a link to this screen"), group: actions, icon: Link2, run: () => void navigator.clipboard?.writeText(shareUrl()).then(() => toast(t("Link copied."))) },
      { id: "theme", label: t("Switch light or dark theme"), group: actions, run: toggleTheme },
      { id: "lang", label: lang === "tr" ? "Switch to English" : "Türkçeye geç", group: actions, run: () => document.querySelector<HTMLButtonElement>(`[data-lang="${lang === "tr" ? "en" : "tr"}"]`)?.click() },
    );
    for (const r of [["tb", "Trial balance"], ["is", "Income statement"], ["bs", "Balance sheet"], ["cf", "Cash flow"], ["vat", "VAT report"]] as const)
      list.push({ id: `r:${r[0]}`, label: t(r[1]), group: t("Reports"), icon: BarChart3, run: () => go({ v: "reports", r: r[0] }) });
    const books = t("Companies");
    for (const b of state.books) list.push({ id: `b:${b.id}`, label: b.name, hint: t(b.chart === "tdhp" ? "Turkish chart" : "International chart"), group: books, icon: Building2, run: () => setActive(b.id) });
    const accts = t("Accounts");
    for (const a of book.accounts) if (!a.header) list.push({ id: `a:${a.code}`, label: `${a.code} ${a.name[lang]}`, group: accts, icon: Rows3, keywords: a.name.en + " " + a.name.tr, run: () => go({ v: "ledger", a: a.code }) });
    const entries = t("Entries");
    for (const e of [...book.entries].reverse().slice(0, 400))
      list.push({ id: `e:${e.id}`, label: `${e.no ? `#${e.no} ` : ""}${translateKnown(lang, e.memo)}`, hint: e.date, group: entries, icon: BookOpen, keywords: e.ref, run: () => go({ v: "journal", e: e.id }) });
    for (const d of book.docs) {
      const p = book.parties.find((x) => x.id === d.party);
      list.push({ id: `d:${d.id}`, label: `${d.number} · ${p?.name ?? ""}`, hint: t(d.kind === "invoice" ? "Invoice" : "Bill"), group: t("Documents"), icon: d.kind === "invoice" ? FileText : Receipt, run: () => go({ v: d.kind === "invoice" ? "sales" : "purchases", d: d.id }) });
    }
    return list;
  }, [t, lang, state.books, book, edit, toast]);

  return (
    <BookContext.Provider value={ctx}>
      <div className="flex min-h-screen">
        <Sidebar route={route} open={menu} onClose={() => setMenu(false)} onNewBook={() => setNewBook(true)} />
        <div className="flex min-w-0 flex-1 flex-col">
          <Header onMenu={() => setMenu(true)} onSearch={openPalette} />
          <main key={`${book.id}:${route.v}`} className="animate-enter mx-auto w-full max-w-[1400px] min-w-0 flex-1 px-4 py-6 md:px-8">
            <ViewSwitch route={route} />
          </main>
        </div>
      </div>
      {editor && <EntryEditor key={editor.entry?.id ?? "new"} entry={editor.entry} preset={editor.preset} onClose={() => setEditor(null)} />}
      <Palette open={palette} onClose={() => setPalette(false)} commands={commands} />
      <NewBook open={newBook} onClose={() => setNewBook(false)} />
    </BookContext.Provider>
  );
}

function ViewSwitch({ route }: { route: Route }) {
  switch (route.v) {
    case "journal":
      return <Journal />;
    case "ledger":
      return <Ledger />;
    case "accounts":
      return <Accounts />;
    case "sales":
      return <Documents kind="invoice" />;
    case "purchases":
      return <Documents kind="bill" />;
    case "reports":
      return <Reports />;
    case "currencies":
      return <Currencies />;
    case "close":
      return <Close />;
    case "import":
      return <Import />;
    case "audit":
      return <Audit />;
    default:
      return <Overview />;
  }
}

function Sidebar({ route, open, onClose, onNewBook }: { route: Route; open: boolean; onClose: () => void; onNewBook: () => void }) {
  const t = useT();
  const groups = [...new Set(NAV.map((n) => n.group))];
  return (
    <>
      {open && <div className="fixed inset-0 z-30 bg-black/30 lg:hidden" onClick={onClose} />}
      <nav
        aria-label={t("Main")}
        className={cx(
          "fixed inset-y-0 left-0 z-40 flex w-64 shrink-0 flex-col border-r border-border bg-bg transition-transform duration-200 lg:sticky lg:top-0 lg:h-screen lg:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex h-14 items-center gap-2 px-4">
          <FolioMark />
          <span className="text-[14px] font-semibold tracking-[-0.01em]">Folio</span>
          <span className="text-xs text-faint">{t("Double-entry ledger")}</span>
        </div>
        <BookSwitcher onNewBook={onNewBook} />
        <div className="scroll-thin flex-1 overflow-y-auto px-2 pb-4">
          {groups.map((g) => (
            <div key={g} className="mt-4">
              <p className="px-2 pb-1 text-[11px] font-medium tracking-wide text-faint uppercase">{t(g)}</p>
              {NAV.filter((n) => n.group === g).map((n) => {
                const active = route.v === n.v;
                return (
                  <button
                    key={n.v}
                    onClick={() => {
                      go({ v: n.v });
                      onClose();
                    }}
                    aria-current={active ? "page" : undefined}
                    className={cx("flex h-8 w-full items-center gap-2.5 rounded-md px-2 text-left transition-colors", active ? "bg-surface-3 font-medium text-text" : "text-muted hover:bg-surface-2 hover:text-text")}
                  >
                    <n.icon className="size-4 shrink-0" />
                    {t(n.label)}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
        <SidebarFooter />
      </nav>
    </>
  );
}

function SidebarFooter() {
  const t = useT();
  const { book } = useBook();
  const drafts = book.entries.filter((e) => e.status === "draft").length;
  return (
    <div className="border-t border-border p-3 text-xs text-muted">
      <p className="flex items-center gap-1.5">
        <Lock className="size-3" />
        {book.lockedThrough ? t("Locked through {date}", { date: fmtDate(book.lockedThrough) }) : t("No period is locked")}
      </p>
      {drafts > 0 && (
        <button onClick={() => go({ v: "journal", q: "status:draft" })} className="mt-1 text-left text-warning hover:underline">
          {t(drafts === 1 ? "{n} draft waiting to be posted" : "{n} drafts waiting to be posted", { n: drafts })}
        </button>
      )}
    </div>
  );
}

function BookSwitcher({ onNewBook }: { onNewBook: () => void }) {
  const t = useT();
  const { state, book, act } = useBook();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);
  return (
    <div ref={ref} className="relative px-3">
      <button onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="menu" className="flex w-full items-center gap-2.5 rounded-lg border border-border bg-surface p-2 text-left shadow-card hover:bg-surface-2">
        <span className="grid size-7 shrink-0 place-items-center rounded-md bg-surface-3 text-xs font-semibold text-muted">{book.name.slice(0, 2).toUpperCase()}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{book.name}</span>
          <span className="block truncate text-xs text-muted">{t(book.chart === "tdhp" ? "Turkish chart (Tekdüzen)" : "International chart")}</span>
        </span>
        <ChevronDown className="size-3.5 text-muted" />
      </button>
      {open && (
        <div role="menu" className="animate-pop absolute inset-x-3 top-full z-50 mt-1 rounded-lg border border-border bg-surface p-1 shadow-pop">
          {state.books.map((b) => (
            <button
              key={b.id}
              role="menuitemradio"
              aria-checked={b.id === book.id}
              onClick={() => {
                setActive(b.id);
                setOpen(false);
              }}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-surface-2"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate">{b.name}</span>
                <span className="block truncate text-xs text-muted">{t(b.chart === "tdhp" ? "Turkish chart (Tekdüzen)" : "International chart")}{b.demo ? ` · ${t("demo")}` : ""}</span>
              </span>
              {b.id === book.id && <CheckIcon className="size-3.5 text-accent" />}
            </button>
          ))}
          <div className="my-1 border-t border-border" />
          <button role="menuitem" onClick={() => (setOpen(false), onNewBook())} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-muted hover:bg-surface-2 hover:text-text">
            <Plus className="size-3.5" /> {t("New company")}
          </button>
          {book.demo && state.edited.includes(book.id) && (
            <button
              role="menuitem"
              onClick={() => {
                setOpen(false);
                act((b) => b);
                resetDemo(book.id);
              }}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-muted hover:bg-surface-2 hover:text-text"
            >
              <RotateCcw className="size-3.5" /> {t("Reset the demo books")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function Header({ onMenu, onSearch }: { onMenu: () => void; onSearch: () => void }) {
  const t = useT();
  const { edit, period, today } = useBook();
  const route = useRoute();
  const nav = NAV.find((n) => n.v === route.v);
  const preset = PRESETS.find((p) => {
    const r = presetRange(p, today);
    return r.from === period.from && r.to === period.to;
  });
  return (
    <header className="sticky top-0 z-20 flex h-14 min-w-0 items-center gap-2 border-b border-border bg-bg/85 px-3 backdrop-blur sm:px-4 md:px-8">
      <button onClick={onMenu} className="rounded-md p-1.5 text-muted hover:bg-surface-2 lg:hidden" aria-label={t("Open menu")}>
        <Menu className="size-4" />
      </button>
      <p className="hidden min-w-0 truncate font-medium md:block">{nav ? t(nav.label) : ""}</p>
      <div className="ml-auto flex min-w-0 items-center gap-1.5">
        <label className="sr-only" htmlFor="period">
          {t("Period")}
        </label>
        <select
          id="period"
          value={preset ?? "custom"}
          onChange={(e) => {
            const p = e.target.value as Preset;
            go(presetRange(p, today), { replace: true });
          }}
          className="h-8 w-32 min-w-0 rounded-md border border-border bg-surface px-2 text-[13px] shadow-card sm:w-auto"
        >
          {PRESETS.map((p) => (
            <option key={p} value={p}>
              {t(PRESET_LABEL[p])}
            </option>
          ))}
          {!preset && <option value="custom">{`${period.from} – ${period.to}`}</option>}
        </select>
        <button onClick={onSearch} className="flex h-8 items-center gap-2 rounded-md border border-border bg-surface px-2.5 text-muted shadow-card hover:bg-surface-2" aria-label={t("Search and commands")}>
          <Search className="size-3.5" />
          <span className="hidden xl:inline">{t("Search…")}</span>
          <kbd className="hidden rounded border border-border px-1 text-[10px] md:inline">⌘K</kbd>
        </button>
        <Button variant="primary" onClick={() => edit(null)} aria-label={t("New entry")} className="px-2.5 sm:px-3">
          <Plus /> <span className="hidden sm:inline">{t("New entry")}</span>
        </Button>
        <LangToggle className="hidden sm:inline-flex" />
        <ThemeToggle />
        <a href="https://github.com/ozenyunus35/double-entry-ledger" target="_blank" rel="noreferrer" className="hidden rounded-md p-1.5 text-muted hover:bg-surface-2 hover:text-text sm:inline-flex" aria-label={t("Source code on GitHub")}>
          <svg viewBox="0 0 16 16" className="size-4" fill="currentColor" aria-hidden>
            <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
          </svg>
        </a>
      </div>
    </header>
  );
}
