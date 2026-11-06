"use client";

import { Ban, BookOpen, FileText, Plus, Receipt, Trash2, Wallet } from "lucide-react";
import { useMemo, useState } from "react";
import { aging, BUCKETS, createDoc, docStatus, docTotals, lineNet, openAmount, paid, recordPayment, voidDoc, VAT_RATES, type DocStatus } from "@/lib/docs";
import { amount, date as fmtDate, money, percent, rate as fmtRate } from "@/lib/format";
import { rateOn } from "@/lib/fx";
import { useLang, useT } from "@/lib/i18n";
import { parseRate } from "@/lib/importer";
import { addDays, sortedAccounts } from "@/lib/ledger";
import { CURRENCIES, parseAmount, type Currency } from "@/lib/money";
import { go, useRoute } from "@/lib/route";
import type { Doc, DocLine } from "@/lib/types";
import { useBook } from "../app";
import { Badge, Button, Card, Drawer, EmptyState, Field, Modal, PageHeader, Segmented, cx, inputClass, num, td, th, type Tone } from "../ui";

const STATUS_TONE: Record<DocStatus, Tone> = { paid: "success", partial: "info", overdue: "danger", open: "neutral", void: "neutral" };
const STATUS_LABEL: Record<DocStatus, string> = { paid: "Paid", partial: "Part paid", overdue: "Overdue", open: "Open", void: "Void" };

export function Documents({ kind }: { kind: "invoice" | "bill" }) {
  const t = useT();
  const { book, today, period } = useBook();
  const route = useRoute();
  const [filter, setFilter] = useState<"all" | "open" | "overdue" | "paid">("all");
  const v = kind === "invoice" ? "sales" : "purchases";
  const rateFor = (c: Currency) => rateOn(book, c, today) ?? 1;
  const ag = aging(book, kind, today, rateFor);
  const buckets = BUCKETS.map((_, i) => ag.filter((r) => r.bucket === i).reduce((a, r) => a + r.base, 0));
  const docs = useMemo(
    () =>
      book.docs
        .filter((d) => d.kind === kind)
        .filter((d) => openAmount(d) > 0 || (d.date >= period.from && d.date <= period.to))
        .filter((d) => {
          const s = docStatus(d, today);
          return filter === "all" || (filter === "open" ? s === "open" || s === "partial" || s === "overdue" : s === filter);
        })
        .sort((a, b) => b.date.localeCompare(a.date) || b.number.localeCompare(a.number)),
    [book.docs, kind, period, filter, today],
  );
  const open = route.d && route.d !== "new" ? book.docs.find((d) => d.id === route.d) : undefined;

  return (
    <>
      <PageHeader
        title={t(kind === "invoice" ? "Sales invoices" : "Bills")}
        description={t(kind === "invoice" ? "Invoices post to receivables and sales; payments clear them, with exchange differences booked on the day." : "Supplier bills post to expenses and input VAT; payments clear payables.")}
        actions={
          <Button variant="primary" onClick={() => go({ v, d: "new" })}>
            <Plus /> {t(kind === "invoice" ? "New invoice" : "New bill")}
          </Button>
        }
      />
      <div className="mb-3 grid grid-cols-2 gap-3 md:grid-cols-5">
        {BUCKETS.map((b, i) => (
          <div key={b} className="rounded-lg border border-border bg-surface p-3 shadow-card">
            <p className={cx("text-xs", i === 0 ? "text-muted" : i < 3 ? "text-warning" : "text-danger")}>{t(b)}</p>
            <p className="mt-1 font-mono text-[15px] font-medium tabular-nums">{money(buckets[i])}</p>
          </div>
        ))}
      </div>
      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
          <Segmented
            value={filter}
            onChange={setFilter}
            label={t("Status")}
            options={[
              { value: "all", label: t("All") },
              { value: "open", label: t("Unpaid") },
              { value: "overdue", label: t("Overdue") },
              { value: "paid", label: t("Paid") },
            ]}
          />
          <p className="ml-auto text-xs text-muted">{t("{n} documents · open ones are shown whatever their date", { n: docs.length })}</p>
        </div>
        {docs.length === 0 ? (
          <EmptyState icon={kind === "invoice" ? FileText : Receipt} title={t("Nothing here")} text={t("Try another filter or period.")} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-[13px]">
              <thead className="border-b border-border">
                <tr>
                  <th className={th}>{t("Number")}</th>
                  <th className={th}>{t(kind === "invoice" ? "Customer" : "Supplier")}</th>
                  <th className={th}>{t("Date")}</th>
                  <th className={th}>{t("Due")}</th>
                  <th className={cx(th, "text-right")}>{t("Total")}</th>
                  <th className={cx(th, "text-right")}>{t("Open")}</th>
                  <th className={th}>{t("Status")}</th>
                </tr>
              </thead>
              <tbody>
                {docs.map((d) => {
                  const s = docStatus(d, today);
                  const p = book.parties.find((x) => x.id === d.party);
                  return (
                    <tr key={d.id} onClick={() => go({ v, d: d.id })} className={cx("cursor-pointer border-b border-border last:border-0 hover:bg-surface-2", route.d === d.id && "bg-accent-soft")}>
                      <td className={cx(td, "font-mono text-xs")}>{d.number}</td>
                      <td className={td}>
                        <span className="block max-w-56 truncate">{p?.name}</span>
                      </td>
                      <td className={cx(td, "whitespace-nowrap text-muted")}>{fmtDate(d.date)}</td>
                      <td className={cx(td, "whitespace-nowrap text-muted")}>{fmtDate(d.due)}</td>
                      <td className={cx(td, num)}>{money(docTotals(d).total, d.currency)}</td>
                      <td className={cx(td, num, !openAmount(d) && "text-faint")}>{money(openAmount(d), d.currency)}</td>
                      <td className={td}>
                        <Badge tone={STATUS_TONE[s]}>{t(STATUS_LABEL[s])}</Badge>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {open && <DocDrawer doc={open} onClose={() => go({ v }, { replace: true })} />}
      {route.d === "new" && <DocEditor kind={kind} onClose={() => go({ v }, { replace: true })} />}
    </>
  );
}

function DocDrawer({ doc, onClose }: { doc: Doc; onClose: () => void }) {
  const t = useT();
  const { lang } = useLang();
  const { book, today, act } = useBook();
  const [paying, setPaying] = useState(false);
  const party = book.parties.find((p) => p.id === doc.party);
  const totals = docTotals(doc);
  const s = docStatus(doc, today);
  const acc = new Map(book.accounts.map((a) => [a.code, a]));
  return (
    <Drawer
      open
      onClose={onClose}
      title={`${t(doc.kind === "invoice" ? "Invoice" : "Bill")} ${doc.number}`}
      footer={
        <>
          <Button variant="ghost" onClick={() => go({ v: "journal", e: doc.entry })}>
            <BookOpen /> {t("Journal entry")}
          </Button>
          {!doc.void && doc.payments.length === 0 && (
            <Button variant="ghost" onClick={() => act((b) => voidDoc(b, doc.id, today), t("Document voided."))}>
              <Ban /> {t("Void")}
            </Button>
          )}
          {openAmount(doc) > 0 && (
            <Button variant="primary" onClick={() => setPaying(true)}>
              <Wallet /> {t(doc.kind === "invoice" ? "Record payment" : "Pay bill")}
            </Button>
          )}
        </>
      }
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[15px] font-semibold">{party?.name}</p>
          <p className="text-xs text-muted">
            {party?.country} · {party?.email ?? party?.taxId ?? ""}
          </p>
        </div>
        <Badge tone={STATUS_TONE[s]}>{t(STATUS_LABEL[s])}</Badge>
      </div>
      <dl className="mt-4 grid grid-cols-3 gap-3 text-xs">
        <div>
          <dt className="text-faint">{t("Date")}</dt>
          <dd className="mt-0.5">{fmtDate(doc.date)}</dd>
        </div>
        <div>
          <dt className="text-faint">{t("Due")}</dt>
          <dd className="mt-0.5">{fmtDate(doc.due)}</dd>
        </div>
        <div>
          <dt className="text-faint">{t("Currency")}</dt>
          <dd className="mt-0.5">{doc.currency !== "TRY" ? `${doc.currency} @ ${fmtRate(doc.rate)}` : "TRY"}</dd>
        </div>
      </dl>
      <div className="mt-4 overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-[13px]">
          <thead className="bg-surface-2">
            <tr>
              <th className={th}>{t("Description")}</th>
              <th className={cx(th, "text-right")}>{t("Qty")}</th>
              <th className={cx(th, "text-right")}>{t("Price")}</th>
              <th className={cx(th, "text-right")}>{t("VAT")}</th>
              <th className={cx(th, "text-right")}>{t("Net")}</th>
            </tr>
          </thead>
          <tbody>
            {doc.lines.map((l, i) => (
              <tr key={i} className="border-t border-border">
                <td className="px-3 py-2">
                  {l.description}
                  <p className="text-xs text-muted">
                    {l.account} · {acc.get(l.account)?.name[lang]}
                  </p>
                </td>
                <td className={cx("px-3 py-2", num)}>{l.quantity}</td>
                <td className={cx("px-3 py-2", num)}>{amount(l.price)}</td>
                <td className={cx("px-3 py-2", num)}>{l.vat ? percent(l.vat) : t("exempt")}</td>
                <td className={cx("px-3 py-2", num)}>{amount(lineNet(l))}</td>
              </tr>
            ))}
          </tbody>
          <tfoot className="border-t border-border bg-surface-2 text-xs">
            <tr>
              <td colSpan={4} className="px-3 py-1.5 text-right text-muted">
                {t("Net")}
              </td>
              <td className={cx("px-3 py-1.5", num)}>{amount(totals.net)}</td>
            </tr>
            <tr>
              <td colSpan={4} className="px-3 py-1.5 text-right text-muted">
                {t("VAT")}
              </td>
              <td className={cx("px-3 py-1.5", num)}>{amount(totals.vat)}</td>
            </tr>
            <tr className="font-medium">
              <td colSpan={4} className="px-3 py-1.5 text-right">
                {t("Total")}
              </td>
              <td className={cx("px-3 py-1.5", num)}>{money(totals.total, doc.currency)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <h3 className="mt-5 mb-2 text-xs font-medium text-muted">{t("Payments")}</h3>
      {doc.payments.length === 0 ? (
        <p className="text-xs text-muted">{t("No payments yet.")}</p>
      ) : (
        <ul className="space-y-1.5">
          {doc.payments.map((p) => {
            const e = book.entries.find((x) => x.id === p.entry);
            const fxLine = e?.lines.find((l) => acc.get(l.account)?.role === "fx-gain" || acc.get(l.account)?.role === "fx-loss");
            return (
              <li key={p.id}>
                <button onClick={() => go({ v: "journal", e: p.entry })} className="flex w-full items-center justify-between gap-3 rounded-md border border-border px-3 py-2 text-left text-xs hover:bg-surface-2">
                  <span>
                    {fmtDate(p.date)} · {acc.get(p.account)?.name[lang]}
                    {doc.currency !== "TRY" && <span className="text-muted"> · @ {fmtRate(p.rate)}</span>}
                    {fxLine && <span className={cx("ml-1", acc.get(fxLine.account)?.role === "fx-gain" ? "text-success" : "text-danger")}> · {t(acc.get(fxLine.account)?.role === "fx-gain" ? "exchange gain {a}" : "exchange loss {a}", { a: money(fxLine.debit || fxLine.credit) })}</span>}
                  </span>
                  <span className={num}>{money(p.amount, doc.currency)}</span>
                </button>
              </li>
            );
          })}
          <li className="flex justify-between px-3 pt-1 text-xs text-muted">
            <span>{t("Paid {paid} · open {open}", { paid: money(paid(doc), doc.currency), open: money(openAmount(doc), doc.currency) })}</span>
          </li>
        </ul>
      )}
      {paying && <PaymentDialog doc={doc} onClose={() => setPaying(false)} />}
    </Drawer>
  );
}

function PaymentDialog({ doc, onClose }: { doc: Doc; onClose: () => void }) {
  const t = useT();
  const { lang } = useLang();
  const { book, today, act } = useBook();
  const banks = book.accounts.filter((a) => a.section === "cash" && !a.header && (!a.currency || a.currency === doc.currency || doc.currency === "TRY"));
  const preferred = banks.find((a) => a.currency === doc.currency) ?? banks.find((a) => a.role === "bank-try") ?? banks[0];
  const [date, setDate] = useState(today);
  const [account, setAccount] = useState(preferred?.code ?? "");
  const [value, setValue] = useState(amount(openAmount(doc)));
  const [rate, setRate] = useState(String(rateOn(book, doc.currency, today) ?? doc.rate));
  const parsed = parseAmount(value);
  const submit = () => {
    if (parsed === null) return;
    const ok = act((b) => recordPayment(b, doc.id, { date, amount: parsed, rate: doc.currency === "TRY" ? 1 : parseRate(rate), account }).book, t("Payment recorded."));
    if (ok) onClose();
  };
  return (
    <Modal
      open
      onClose={onClose}
      title={t(doc.kind === "invoice" ? "Record payment for {n}" : "Pay bill {n}", { n: doc.number })}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t("Cancel")}
          </Button>
          <Button variant="primary" onClick={submit} disabled={parsed === null || parsed <= 0}>
            {t("Post payment")}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("Date")}>{(id) => <input id={id} type="date" value={date} min={doc.date} onChange={(e) => { setDate(e.target.value); const r = rateOn(book, doc.currency, e.target.value); if (r) setRate(String(r)); }} className={inputClass} />}</Field>
          <Field label={t("Amount in {cur}", { cur: doc.currency })} error={value && parsed === null ? t("Not an amount") : undefined}>
            {(id, d) => <input id={id} aria-describedby={d} value={value} onChange={(e) => setValue(e.target.value)} inputMode="decimal" className={cx(inputClass, "text-right font-mono")} />}
          </Field>
        </div>
        <Field label={t(doc.kind === "invoice" ? "Received into" : "Paid from")}>
          {(id) => (
            <select id={id} value={account} onChange={(e) => setAccount(e.target.value)} className={inputClass}>
              {banks.map((a) => (
                <option key={a.code} value={a.code}>
                  {a.code} · {a.name[lang]}
                </option>
              ))}
            </select>
          )}
        </Field>
        {doc.currency !== "TRY" && (
          <Field label={t("Rate on the payment day")} hint={t("The invoice was booked at {rate}. The difference is a realised exchange gain or loss.", { rate: fmtRate(doc.rate) })}>
            {(id, d) => <input id={id} aria-describedby={d} value={rate} onChange={(e) => setRate(e.target.value)} inputMode="decimal" className={cx(inputClass, "font-mono")} />}
          </Field>
        )}
      </div>
    </Modal>
  );
}

interface FormLine {
  key: number;
  description: string;
  quantity: string;
  price: string;
  vat: number;
  account: string;
}
let k = 0;

function DocEditor({ kind, onClose }: { kind: "invoice" | "bill"; onClose: () => void }) {
  const t = useT();
  const { lang } = useLang();
  const { book, today, act } = useBook();
  const parties = book.parties.filter((p) => p.kind === (kind === "invoice" ? "customer" : "supplier"));
  const accounts = sortedAccounts(book).filter((a) => !a.header && !a.archived && (kind === "invoice" ? a.type === "income" && !a.contra : a.type === "expense" || a.section === "fixed-assets" || a.role === "prepaid"));
  const nextNumber = useMemo(() => {
    if (kind === "bill") return "";
    const nums = book.docs.filter((d) => d.kind === "invoice").map((d) => /(\d+)$/.exec(d.number)?.[1]).filter(Boolean).map(Number);
    const prefix = book.docs.find((d) => d.kind === "invoice")?.number.replace(/\d+$/, "") ?? "INV-";
    return `${prefix}${(nums.length ? Math.max(...nums) : 0) + 1}`;
  }, [book.docs, kind]);
  const [party, setParty] = useState(parties[0]?.id ?? "");
  const p = parties.find((x) => x.id === party);
  const [number, setNumber] = useState(nextNumber);
  const [date, setDate] = useState(today);
  const [currency, setCurrency] = useState<Currency>(p?.currency ?? "TRY");
  const [rate, setRate] = useState(String(rateOn(book, p?.currency ?? "TRY", today) ?? 1));
  const defaultAccount = kind === "invoice" ? accounts.find((a) => a.role === (currency === "TRY" ? "sales-domestic" : "sales-export"))?.code : accounts.find((a) => a.role === "office")?.code;
  const [lines, setLines] = useState<FormLine[]>([{ key: ++k, description: "", quantity: "1", price: "", vat: currency === "TRY" ? 20 : 0, account: defaultAccount ?? "" }]);
  const [tried, setTried] = useState(false);

  const docLines: DocLine[] = lines.map((l) => ({ description: l.description.trim() || t("Services"), quantity: Number(l.quantity.replace(",", ".")) || 0, price: parseAmount(l.price) ?? -1, vat: l.vat, account: l.account }));
  const totals = docTotals({ lines: docLines.map((l) => ({ ...l, price: Math.max(l.price, 0) })) });
  const terms = p?.terms ?? 30;

  const choose = (id: string) => {
    setParty(id);
    const np = parties.find((x) => x.id === id);
    if (np) {
      setCurrency(np.currency);
      setRate(String(rateOn(book, np.currency, date) ?? 1));
      const vat = np.currency === "TRY" || np.country === "TR" ? 20 : 0;
      setLines((ls) => ls.map((l) => ({ ...l, vat: kind === "invoice" ? vat : l.vat, account: kind === "invoice" ? accounts.find((a) => a.role === (np.country === "TR" ? "sales-domestic" : "sales-export"))?.code ?? l.account : l.account })));
    }
  };

  const submit = () => {
    setTried(true);
    let id = "";
    const ok = act(
      (b) => {
        const r = createDoc(b, { kind, number, party, date, due: addDays(date, terms), currency, rate: currency === "TRY" ? 1 : parseRate(rate), lines: docLines });
        id = r.doc.id;
        return r.book;
      },
      t(kind === "invoice" ? "Invoice {n} posted." : "Bill {n} posted.", { n: number }),
    );
    if (ok) go({ v: kind === "invoice" ? "sales" : "purchases", d: id }, { replace: true });
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={t(kind === "invoice" ? "New sales invoice" : "New bill")}
      size="xl"
      footer={
        <>
          <p className="mr-auto text-xs text-muted">
            {t("Total {total} · VAT {vat}", { total: money(totals.total, currency), vat: money(totals.vat, currency) })}
            {currency !== "TRY" && ` · ≈ ${money(Math.round((totals.total / 100) * (parseRate(rate) || 0) * 100))}`}
          </p>
          <Button variant="ghost" onClick={onClose}>
            {t("Cancel")}
          </Button>
          <Button variant="primary" onClick={submit}>
            {t(kind === "invoice" ? "Issue invoice" : "Record bill")}
          </Button>
        </>
      }
    >
      {parties.length === 0 ? (
        <EmptyState icon={FileText} title={t("No customers or suppliers yet")} text={t("This company has no parties. Add them through a CSV import or use the demo books.")} />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <Field label={t(kind === "invoice" ? "Customer" : "Supplier")} className="lg:col-span-2">
              {(id) => (
                <select id={id} value={party} onChange={(e) => choose(e.target.value)} className={inputClass}>
                  {parties.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name} · {x.country}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <Field label={t("Number")}>{(id) => <input id={id} value={number} onChange={(e) => setNumber(e.target.value)} className={cx(inputClass, "font-mono")} />}</Field>
            <Field label={t("Date")} hint={t("Due {date} ({n} days)", { date: fmtDate(addDays(date, terms)), n: terms })}>
              {(id, d) => <input id={id} aria-describedby={d} type="date" value={date} onChange={(e) => { setDate(e.target.value); const r = rateOn(book, currency, e.target.value); if (r) setRate(String(r)); }} className={inputClass} />}
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label={t("Currency")}>
                {(id) => (
                  <select id={id} value={currency} onChange={(e) => { const c = e.target.value as Currency; setCurrency(c); setRate(String(rateOn(book, c, date) ?? 1)); }} className={inputClass}>
                    {CURRENCIES.map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                )}
              </Field>
              <Field label={t("Rate")}>{(id) => <input id={id} value={currency === "TRY" ? "1" : rate} disabled={currency === "TRY"} onChange={(e) => setRate(e.target.value)} className={cx(inputClass, "font-mono")} inputMode="decimal" />}</Field>
            </div>
          </div>
          <div className="mt-4 overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[760px] text-[13px]">
              <thead className="bg-surface-2">
                <tr>
                  <th className={th}>{t("Description")}</th>
                  <th className={cx(th, "w-56")}>{t("Account")}</th>
                  <th className={cx(th, "w-20 text-right")}>{t("Qty")}</th>
                  <th className={cx(th, "w-32 text-right")}>{t("Price")}</th>
                  <th className={cx(th, "w-24")}>{t("VAT")}</th>
                  <th className={cx(th, "w-28 text-right")}>{t("Net")}</th>
                  <th className="w-9" />
                </tr>
              </thead>
              <tbody>
                {lines.map((l, i) => {
                  const set = (patch: Partial<FormLine>) => setLines((ls) => ls.map((x) => (x.key === l.key ? { ...x, ...patch } : x)));
                  const priceBad = (tried || l.price) && (parseAmount(l.price) === null || (parseAmount(l.price) ?? 0) < 0);
                  return (
                    <tr key={l.key} className="border-t border-border">
                      <td className="p-1.5">
                        <input value={l.description} onChange={(e) => set({ description: e.target.value })} placeholder={t("What was sold or bought")} aria-label={t("Description for line {n}", { n: i + 1 })} className={inputClass} maxLength={120} />
                      </td>
                      <td className="p-1.5">
                        <select value={l.account} onChange={(e) => set({ account: e.target.value })} aria-label={t("Account for line {n}", { n: i + 1 })} className={inputClass}>
                          {accounts.map((a) => (
                            <option key={a.code} value={a.code}>
                              {a.code} · {a.name[lang]}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="p-1.5">
                        <input value={l.quantity} onChange={(e) => set({ quantity: e.target.value })} inputMode="decimal" aria-label={t("Quantity for line {n}", { n: i + 1 })} className={cx(inputClass, "text-right font-mono")} />
                      </td>
                      <td className="p-1.5">
                        <input value={l.price} onChange={(e) => set({ price: e.target.value })} inputMode="decimal" aria-label={t("Price for line {n}", { n: i + 1 })} aria-invalid={!!priceBad} className={cx(inputClass, "text-right font-mono")} />
                      </td>
                      <td className="p-1.5">
                        <select value={l.vat} onChange={(e) => set({ vat: Number(e.target.value) })} aria-label={t("VAT for line {n}", { n: i + 1 })} className={inputClass}>
                          {VAT_RATES.map((r) => (
                            <option key={r} value={r}>
                              {r ? percent(r) : t("exempt")}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className={cx("p-1.5 px-3", num)}>{amount(lineNet(docLines[i].price < 0 ? { ...docLines[i], price: 0 } : docLines[i]))}</td>
                      <td className="p-1.5">
                        <button onClick={() => setLines((ls) => (ls.length > 1 ? ls.filter((x) => x.key !== l.key) : ls))} className="rounded-md p-1 text-faint hover:bg-surface-2 hover:text-danger" aria-label={t("Remove line {n}", { n: i + 1 })}>
                          <Trash2 className="size-3.5" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Button size="sm" variant="ghost" className="mt-2" onClick={() => setLines((ls) => [...ls, { key: ++k, description: "", quantity: "1", price: "", vat: ls[ls.length - 1]?.vat ?? 20, account: ls[ls.length - 1]?.account ?? defaultAccount ?? "" }])}>
            <Plus /> {t("Add line")}
          </Button>
          <p className="mt-3 text-xs text-faint">{t(kind === "invoice" ? "Issuing posts the entry right away: receivables against sales and output VAT. Export of services is exempt from VAT." : "Recording posts the entry right away: expenses and input VAT against payables.")}</p>
        </>
      )}
    </Modal>
  );
}
