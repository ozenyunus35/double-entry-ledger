"use client";

import { Plus, Scale, Trash2 } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { rateOn } from "@/lib/fx";
import { useKnown, useLang, useT } from "@/lib/i18n";
import { parseRate } from "@/lib/importer";
import { cleanLines, postDraft, saveDraft, sortedAccounts, sum, validateEntry } from "@/lib/ledger";
import { CURRENCIES, convert, parseAmount, type Currency } from "@/lib/money";
import { amount, date as fmtDate, rate as fmtRate } from "@/lib/format";
import type { Entry, Line } from "@/lib/types";
import { go } from "@/lib/route";
import { useBook } from "./app";
import { Button, Modal, cx, inputClass } from "./ui";

interface Row {
  key: number;
  account: string;
  memo: string;
  debit: string;
  credit: string;
  currency: Currency;
  rate: string;
}

let rowKey = 0;
const blank = (): Row => ({ key: ++rowKey, account: "", memo: "", debit: "", credit: "", currency: "TRY", rate: "" });

function toRow(l: Line): Row {
  const foreign = l.currency && l.currency !== "TRY" && l.fx;
  const fx = (n: number) => (n ? amount(n) : "");
  return {
    key: ++rowKey,
    account: l.account,
    memo: l.memo ?? "",
    debit: foreign ? (l.debit ? fx(l.fx!) : "") : fx(l.debit),
    credit: foreign ? (l.credit ? fx(l.fx!) : "") : fx(l.credit),
    currency: (l.currency as Currency) ?? "TRY",
    rate: l.rate ? String(l.rate) : "",
  };
}

/** A form row as a ledger line; amounts typed in a foreign currency are converted at the line's rate. */
function toLine(r: Row): Line {
  const d = parseAmount(r.debit) ?? 0;
  const c = parseAmount(r.credit) ?? 0;
  if (r.currency === "TRY") return { account: r.account, debit: Math.max(d, 0) + Math.max(-c, 0), credit: Math.max(c, 0) + Math.max(-d, 0), memo: r.memo || undefined };
  const rate = parseRate(r.rate);
  const fx = Math.abs(d || c);
  const base = rate > 0 ? convert(fx, rate) : 0;
  return { account: r.account, debit: d ? base : 0, credit: c ? base : 0, currency: r.currency, fx, rate: rate > 0 ? rate : undefined, memo: r.memo || undefined };
}

export function EntryEditor({ entry, preset, onClose }: { entry: Entry | null; preset?: Partial<Entry>; onClose: () => void }) {
  const t = useT();
  const known = useKnown();
  const { lang } = useLang();
  const { book, today, act } = useBook();
  const source = entry ?? preset;
  const [date, setDate] = useState(source?.date ?? today);
  const [memo, setMemo] = useState(source?.memo ? known(source.memo) : "");
  const [ref, setRef] = useState(source?.ref ?? "");
  const [rows, setRows] = useState<Row[]>(() => {
    const r = (source?.lines ?? []).map(toRow);
    while (r.length < 2) r.push(blank());
    return r;
  });
  const [tried, setTried] = useState(false);
  const formRef = useRef<HTMLDivElement>(null);

  const accounts = useMemo(() => sortedAccounts(book).filter((a) => !a.archived), [book]);
  const lines = useMemo(() => cleanLines(rows.map(toLine)), [rows]);
  const issues = useMemo(() => validateEntry(book, { date, lines }), [book, date, lines]);
  // Validation numbers the lines that have content; this finds a form row's number among them.
  const lineOfRow = useMemo(() => {
    const m = new Map<number, number>();
    let k = 0;
    for (const r of rows) if (r.account || r.debit || r.credit) m.set(r.key, k++);
    return m;
  }, [rows]);
  const debit = sum(lines, "debit");
  const credit = sum(lines, "credit");
  const diff = debit - credit;

  const set = (key: number, patch: Partial<Row>) =>
    setRows((rs) =>
      rs.map((r) => {
        if (r.key !== key) return r;
        const next = { ...r, ...patch };
        if (patch.debit && patch.debit.trim()) next.credit = "";
        if (patch.credit && patch.credit.trim()) next.debit = "";
        if (patch.account) {
          const a = book.accounts.find((x) => x.code === patch.account);
          if (a?.currency && a.currency !== next.currency) next.currency = a.currency as Currency;
        }
        if ((patch.currency || patch.account) && next.currency !== "TRY" && !next.rate) {
          const rt = rateOn(book, next.currency, date);
          if (rt) next.rate = String(rt);
        }
        return next;
      }),
    );

  /** Puts the difference on the first row that has an account but no amount, or a new row. */
  const balance = () => {
    if (!diff) return;
    setRows((rs) => {
      const target = rs.find((r) => r.account && !r.debit.trim() && !r.credit.trim() && r.currency === "TRY") ?? rs.find((r) => !r.account && !r.debit && !r.credit);
      const side = diff > 0 ? { credit: amount(diff), debit: "" } : { debit: amount(-diff), credit: "" };
      if (target) return rs.map((r) => (r.key === target.key ? { ...r, ...side } : r));
      return [...rs, { ...blank(), ...side }];
    });
  };

  const save = (post: boolean) => {
    setTried(true);
    if (post && issues.length) return;
    let id = entry?.id;
    const ok = act(
      (b) => {
        const d = saveDraft(b, { date, memo: memo.trim() || t("Journal entry"), ref, lines }, entry?.id);
        id = d.entry.id;
        return post ? postDraft(d.book, d.entry.id).book : d.book;
      },
      post ? t("Entry posted.") : t("Draft saved."),
    );
    if (ok) {
      onClose();
      if (id) go({ v: "journal", e: id });
    }
  };

  const title = entry ? t("Edit draft entry") : t("New journal entry");
  const shown = tried ? issues : issues.filter((i) => i.code === "unbalanced" || i.code === "locked" || i.code === "fx-mismatch" || i.code === "header-account");

  return (
    <Modal
      open
      onClose={onClose}
      title={title}
      size="xl"
      footer={
        <>
          <p className={cx("mr-auto text-xs", diff ? "text-danger" : lines.length >= 2 ? "text-success" : "text-muted")} aria-live="polite">
            {diff ? t("Out of balance by {diff}", { diff: amount(Math.abs(diff)) }) : lines.length >= 2 ? t("Balanced") : t("Add at least two lines")}
          </p>
          <Button variant="ghost" onClick={onClose}>
            {t("Cancel")}
          </Button>
          <Button onClick={() => save(false)}>{t("Save draft")}</Button>
          <Button variant="primary" onClick={() => save(true)} disabled={tried && issues.length > 0} title={t("⌘ Enter")}>
            {t("Post entry")}
          </Button>
        </>
      }
    >
      <div
        ref={formRef}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
            e.preventDefault();
            save(true);
          }
        }}
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[10rem_1fr_10rem]">
          <label className="space-y-1.5">
            <span className="block text-xs font-medium text-muted">{t("Date")}</span>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputClass} aria-invalid={issues.some((i) => i.code === "bad-date" || i.code === "locked")} />
          </label>
          <label className="space-y-1.5">
            <span className="block text-xs font-medium text-muted">{t("Description")}</span>
            <input value={memo} onChange={(e) => setMemo(e.target.value)} placeholder={t("What happened, e.g. Office rent for March")} className={inputClass} autoFocus maxLength={200} />
          </label>
          <label className="space-y-1.5">
            <span className="block text-xs font-medium text-muted">{t("Reference")}</span>
            <input value={ref} onChange={(e) => setRef(e.target.value)} placeholder={t("Receipt or document no")} className={inputClass} maxLength={60} />
          </label>
        </div>

        <div className="mt-4 overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[720px] text-[13px]">
            <thead className="bg-surface-2">
              <tr>
                <th className="h-8 px-2 text-left text-xs font-medium text-muted">{t("Account")}</th>
                <th className="h-8 px-2 text-left text-xs font-medium text-muted">{t("Line note")}</th>
                <th className="h-8 w-20 px-2 text-left text-xs font-medium text-muted">{t("Currency")}</th>
                <th className="h-8 w-36 px-2 text-right text-xs font-medium text-muted">{t("Debit")}</th>
                <th className="h-8 w-36 px-2 text-right text-xs font-medium text-muted">{t("Credit")}</th>
                <th className="w-9" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const line = toLine(r);
                const bad = tried && issues.some((x) => x.line !== undefined && x.line === lineOfRow.get(r.key));
                return (
                  <tr key={r.key} className="border-t border-border align-top">
                    <td className="p-1.5">
                      <select value={r.account} onChange={(e) => set(r.key, { account: e.target.value })} aria-label={t("Account for line {n}", { n: i + 1 })} aria-invalid={bad} className={cx(inputClass, "pr-6")}>
                        <option value="">{t("Choose an account")}</option>
                        {(["asset", "liability", "equity", "income", "expense"] as const).map((type) => (
                          <optgroup key={type} label={t(TYPE_PLURAL[type])}>
                            {accounts
                              .filter((a) => a.type === type)
                              .map((a) => (
                                <option key={a.code} value={a.code} disabled={a.header}>
                                  {a.code} · {a.name[lang]}
                                </option>
                              ))}
                          </optgroup>
                        ))}
                      </select>
                    </td>
                    <td className="p-1.5">
                      <input value={r.memo} onChange={(e) => set(r.key, { memo: e.target.value })} aria-label={t("Note for line {n}", { n: i + 1 })} className={inputClass} maxLength={120} />
                    </td>
                    <td className="p-1.5">
                      <select value={r.currency} onChange={(e) => set(r.key, { currency: e.target.value as Currency })} aria-label={t("Currency for line {n}", { n: i + 1 })} className={inputClass}>
                        {CURRENCIES.map((c) => (
                          <option key={c}>{c}</option>
                        ))}
                      </select>
                      {r.currency !== "TRY" && (
                        <input value={r.rate} onChange={(e) => set(r.key, { rate: e.target.value })} aria-label={t("Rate for line {n}", { n: i + 1 })} placeholder={t("Rate")} inputMode="decimal" className={cx(inputClass, "mt-1 h-7 text-xs")} />
                      )}
                    </td>
                    {(["debit", "credit"] as const).map((side) => (
                      <td key={side} className="p-1.5">
                        <input
                          value={r[side]}
                          onChange={(e) => set(r.key, { [side]: e.target.value })}
                          onBlur={(e) => {
                            const n = parseAmount(e.target.value);
                            if (n !== null && e.target.value.trim()) set(r.key, { [side]: amount(Math.abs(n)) });
                          }}
                          inputMode="decimal"
                          aria-label={t(side === "debit" ? "Debit for line {n}" : "Credit for line {n}", { n: i + 1 })}
                          aria-invalid={r[side].trim() !== "" && parseAmount(r[side]) === null}
                          className={cx(inputClass, "text-right font-mono tabular-nums")}
                        />
                        {r.currency !== "TRY" && line[side] > 0 && <p className="mt-1 text-right font-mono text-[11px] text-muted">₺{amount(line[side])}</p>}
                      </td>
                    ))}
                    <td className="p-1.5">
                      <button
                        onClick={() => setRows((rs) => (rs.length > 2 ? rs.filter((x) => x.key !== r.key) : rs.map((x) => (x.key === r.key ? blank() : x))))}
                        className="mt-1 rounded-md p-1 text-faint hover:bg-surface-2 hover:text-danger"
                        aria-label={t("Remove line {n}", { n: i + 1 })}
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot className="border-t border-border bg-surface-2">
              <tr>
                <td colSpan={3} className="p-2">
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="ghost" onClick={() => setRows((rs) => [...rs, blank()])}>
                      <Plus /> {t("Add line")}
                    </Button>
                    {diff !== 0 && (
                      <Button size="sm" variant="ghost" onClick={balance}>
                        <Scale /> {t("Balance with the difference")}
                      </Button>
                    )}
                  </div>
                </td>
                <td className="px-3 py-2 text-right font-mono text-[12.5px] font-medium tabular-nums">{amount(debit)}</td>
                <td className="px-3 py-2 text-right font-mono text-[12.5px] font-medium tabular-nums">{amount(credit)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>

        {shown.length > 0 && (
          <ul className="mt-3 space-y-1 rounded-lg border border-danger/30 bg-danger-soft p-3 text-xs text-danger" role="alert">
            {shown.slice(0, 6).map((i, k) => (
              <li key={k}>{t(i.message, i.vars)}</li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-xs text-faint">
          {t("Amounts accept 1,234.56 and 1.234,56. Foreign lines are converted at their rate; the entry must balance in lira. Posted entries can't be edited, only reversed.")}
          {book.lockedThrough && ` ${t("Locked through {date}", { date: fmtDate(book.lockedThrough) })}.`}
          {lines.some((l) => l.rate) && ` ${t("Rates are from the table on the entry date: {rates}.", { rates: [...new Set(lines.filter((l) => l.currency).map((l) => `${l.currency} ${fmtRate(l.rate ?? 0)}`))].join(", ") })}`}
        </p>
      </div>
    </Modal>
  );
}

export const TYPE_PLURAL = { asset: "Assets", liability: "Liabilities", equity: "Equity", income: "Income", expense: "Expenses" } as const;
