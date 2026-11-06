import { LedgerError, addMonths, monthEnd, newId, postEntry, validateEntry } from "./ledger";
import type { Book, Entry, Line, Recurring } from "./types";

/** The day a template runs in a month, moved to the month's last day when the month is shorter. */
export function runDate(r: Pick<Recurring, "day">, month: string): string {
  const end = monthEnd(month);
  const last = Number(end.slice(8));
  return `${month}-${String(Math.min(r.day, last)).padStart(2, "0")}`;
}

/** Months a template still has to run for, up to and including today. */
export function dueMonths(r: Recurring, today: string): string[] {
  if (!r.active) return [];
  const out: string[] = [];
  let m = r.last ? addMonths(r.last, 1) : r.start;
  for (let i = 0; i < 240 && m <= today.slice(0, 7); i++, m = addMonths(m, 1)) if (runDate(r, m) <= today) out.push(m);
  return out;
}

export function addRecurring(book: Book, input: Omit<Recurring, "id" | "last" | "active">): Book {
  if (!input.name.trim()) throw new LedgerError("rec-name", "Give the template a name.");
  if (!Number.isInteger(input.day) || input.day < 1 || input.day > 31) throw new LedgerError("rec-day", "The day must be between 1 and 31.");
  const issues = validateEntry({ ...book, lockedThrough: null }, { date: runDate(input, input.start), lines: input.lines });
  if (issues.length) throw new LedgerError(issues[0].code, issues[0].message, issues[0].vars);
  const r: Recurring = { ...input, id: newId("rec"), last: null, active: true };
  return { ...book, recurring: [...book.recurring, r], audit: [{ at: new Date().toISOString(), action: "recurring", target: r.name, detail: "created" }, ...book.audit] };
}

/** Posts every entry the templates owe up to today. Months inside a locked period are skipped and reported. */
export function runRecurring(book: Book, today: string, at?: string): { book: Book; posted: Entry[]; skipped: { name: string; month: string }[] } {
  let b = book;
  const posted: Entry[] = [];
  const skipped: { name: string; month: string }[] = [];
  for (const r of book.recurring) {
    for (const m of dueMonths(r, today)) {
      const date = runDate(r, m);
      if (b.lockedThrough && date <= b.lockedThrough) {
        skipped.push({ name: r.name, month: m });
      } else {
        const lines: Line[] = r.lines.map((l) => ({ ...l }));
        const res = postEntry(b, { date, memo: r.memo || r.name, lines, source: "recurring" }, at);
        b = res.book;
        posted.push(res.entry);
      }
      b = { ...b, recurring: b.recurring.map((x) => (x.id === r.id ? { ...x, last: m } : x)) };
    }
  }
  return { book: b, posted, skipped };
}
