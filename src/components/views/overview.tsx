"use client";

import { AlertTriangle, ArrowRight, Banknote, FileText, Landmark, Scale, TrendingUp } from "lucide-react";
import { useMemo } from "react";
import { Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { vatReport } from "@/lib/close";
import { aging, BUCKETS, docStatus, openAmount } from "@/lib/docs";
import { amount, compact, date as fmtDate, money, monthName, percent } from "@/lib/format";
import { rateOn, revaluationPreview } from "@/lib/fx";
import { useKnown, useLang, useT } from "@/lib/i18n";
import { addMonths, balances, monthEnd, natural, sortedAccounts, sum } from "@/lib/ledger";
import { go } from "@/lib/route";
import { balanceSheet, cashFlow, incomeStatement, monthly, trialBalance } from "@/lib/reports";
import { lastMonths } from "@/lib/store";
import { useBook } from "../app";
import { Badge, Button, Card, CardHeader, Check, PageHeader, Sparkline, cx, num } from "../ui";

export function Overview() {
  const t = useT();
  const known = useKnown();
  const { lang } = useLang();
  const { book, today, period, edit } = useBook();

  const data = useMemo(() => {
    const months = lastMonths(today, 12);
    const series = monthly(book, months);
    const is = incomeStatement(book, period.from, period.to);
    const bs = balanceSheet(book, period.to);
    const tb = trialBalance(book, period.from, period.to);
    const cf = cashFlow(book, period.from, period.to);
    const bal = balances(book, { to: period.to });
    const accounts = sortedAccounts(book);
    const cash = accounts.filter((a) => a.section === "cash" && !a.header).map((a) => ({ account: a, base: natural(a, bal.get(a.code)), fx: a.currency ? (bal.get(a.code)?.fx[a.currency as "EUR"] ?? 0) : null }));
    const rateFor = (c: Parameters<typeof rateOn>[1]) => rateOn(book, c, period.to) ?? 1;
    const ar = aging(book, "invoice", period.to, rateFor);
    const ap = aging(book, "bill", period.to, rateFor);
    const buckets = BUCKETS.map((_, i) => ar.filter((r) => r.bucket === i).reduce((a, r) => a + r.base, 0));
    const vatMonth = addMonths(today.slice(0, 7), -1);
    const vat = vatReport(book, vatMonth);
    const owed = accounts.filter((a) => a.role === "taxes-payable" || a.role === "social-security-payable" || a.role === "salaries-payable" || a.role === "income-tax-provision").reduce((s, a) => s + natural(a, bal.get(a.code)), 0);
    const lastEnd = monthEnd(vatMonth);
    const revalDone = book.entries.some((e) => e.status === "posted" && e.source === "revaluation" && e.date === lastEnd);
    const revalPending = !revalDone && revaluationPreview(book, lastEnd).length > 0;
    return { months, series, is, bs, tb, cf, cash, ar, ap, buckets, vat, vatMonth, owed, revalPending, lastEnd };
  }, [book, today, period]);

  const drafts = book.entries.filter((e) => e.status === "draft");
  const overdue = data.ar.filter((r) => r.days > 0);
  const recent = book.entries.filter((e) => e.status === "posted").sort((a, b) => b.date.localeCompare(a.date) || (b.no ?? 0) - (a.no ?? 0)).slice(0, 6);
  const totalCash = data.cash.reduce((a, c) => a + c.base, 0);
  const arTotal = data.ar.reduce((a, r) => a + r.base, 0);
  const apTotal = data.ap.reduce((a, r) => a + r.base, 0);
  const margin = data.is.revenue ? Math.round((data.is.net / data.is.revenue) * 100) : 0;
  const chart = data.series.map((s) => ({ month: monthName(s.month, "short").replace(/ \d{4}$/, ""), revenue: s.revenue / 100, expenses: s.expenses / 100, profit: s.profit / 100 }));

  const attention: { tone: "warning" | "danger" | "info"; text: string; action: () => void; label: string }[] = [];
  if (drafts.length) attention.push({ tone: "warning", text: t(drafts.length === 1 ? "{n} draft waiting to be posted" : "{n} drafts waiting to be posted", { n: drafts.length }), action: () => go({ v: "journal", q: "status:draft" }), label: t("Review") });
  if (overdue.length) attention.push({ tone: "danger", text: t(overdue.length === 1 ? "1 invoice overdue, {amount}" : "{n} invoices overdue, {amount} in total", { n: overdue.length, amount: money(overdue.reduce((a, r) => a + r.base, 0)) }), action: () => go({ v: "sales" }), label: t("Open") });
  if (data.revalPending) attention.push({ tone: "info", text: t("Foreign balances aren't revalued for {month} yet", { month: monthName(data.vatMonth) }), action: () => go({ v: "currencies" }), label: t("Revalue") });
  if (!data.vat.settled && (data.vat.output || data.vat.input)) attention.push({ tone: "info", text: t("VAT for {month} isn't settled", { month: monthName(data.vatMonth) }), action: () => go({ v: "close" }), label: t("Settle") });

  return (
    <>
      <PageHeader
        title={book.name}
        description={
          <>
            {book.legalName !== book.name && <span>{book.legalName} · </span>}
            {t("{from} to {to}", { from: fmtDate(period.from), to: fmtDate(period.to) })}
            {book.demo && <span className="ml-2 text-faint">{t("Demo books with invented companies and synthetic exchange rates.")}</span>}
          </>
        }
        actions={
          <>
            <Button onClick={() => go({ v: "reports", r: "is" })}>{t("Open reports")}</Button>
            <Button variant="primary" onClick={() => edit(null)}>
              {t("New entry")}
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi icon={Banknote} label={t("Cash and banks")} value={money(totalCash)} sub={t("{n} accounts, in lira", { n: data.cash.length })} spark={data.series.map((s) => s.cash)} onClick={() => go({ v: "ledger", a: data.cash[1]?.account.code })} />
        <Kpi icon={TrendingUp} label={t("Net profit")} value={money(data.is.net)} sub={t("{margin} margin on {revenue} revenue", { margin: percent(margin), revenue: compact(data.is.revenue) })} spark={data.series.map((s) => s.profit)} onClick={() => go({ v: "reports", r: "is" })} />
        <Kpi icon={FileText} label={t("Receivables")} value={money(arTotal)} sub={overdue.length ? t("{amount} overdue", { amount: money(overdue.reduce((a, r) => a + r.base, 0)) }) : t("Nothing overdue")} tone={overdue.length ? "danger" : undefined} onClick={() => go({ v: "sales" })} />
        <Kpi icon={Landmark} label={t("Payables and taxes")} value={money(apTotal + data.owed)} sub={t("{bills} to suppliers, {taxes} payroll and taxes", { bills: compact(apTotal), taxes: compact(data.owed) })} onClick={() => go({ v: "reports", r: "bs" })} />
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title={t("Revenue, expenses and profit")} meta={t("Last 12 months")} icon={TrendingUp} />
          <div className="h-72 p-3">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chart} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
                <XAxis dataKey="month" tickLine={false} axisLine={false} tick={{ fill: "var(--muted)", fontSize: 11 }} />
                <YAxis tickLine={false} axisLine={false} width={56} tick={{ fill: "var(--muted)", fontSize: 11 }} tickFormatter={(v: number) => compact(v * 100).replace("₺", "")} />
                <Tooltip
                  cursor={{ fill: "var(--accent-soft)" }}
                  contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12, color: "var(--text)" }}
                  formatter={(v, name) => [money(Math.round(Number(v) * 100)), t(String(name))]}
                />
                <Bar dataKey="revenue" name="Revenue" fill="var(--accent)" radius={[3, 3, 0, 0]} maxBarSize={22} animationDuration={600} />
                <Bar dataKey="expenses" name="Expenses" fill="var(--border-strong)" radius={[3, 3, 0, 0]} maxBarSize={22} animationDuration={600} />
                <Line dataKey="profit" name="Net profit" type="monotone" stroke="var(--success)" strokeWidth={2} dot={false} animationDuration={800} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <div className="flex flex-wrap gap-4 border-t border-border px-4 py-2.5 text-xs text-muted">
            <Legend color="var(--accent)" label={t("Revenue")} />
            <Legend color="var(--border-strong)" label={t("Expenses")} />
            <Legend color="var(--success)" label={t("Net profit")} line />
          </div>
        </Card>

        <Card>
          <CardHeader title={t("Needs attention")} icon={AlertTriangle} meta={attention.length ? String(attention.length) : undefined} />
          <div className="divide-y divide-border">
            {attention.length === 0 && <p className="p-4 text-muted">{t("Nothing waiting. The books are up to date.")}</p>}
            {attention.map((a, i) => (
              <div key={i} className="flex items-center gap-3 px-4 py-3">
                <span className={cx("size-1.5 shrink-0 rounded-full", a.tone === "danger" ? "bg-danger" : a.tone === "warning" ? "bg-warning" : "bg-info")} />
                <p className="min-w-0 flex-1">{a.text}</p>
                <Button size="sm" variant="ghost" onClick={a.action}>
                  {a.label} <ArrowRight />
                </Button>
              </div>
            ))}
          </div>
          <div className="space-y-1.5 border-t border-border px-4 py-3">
            <p className="mb-1 text-xs font-medium text-muted">{t("Checks on these books")}</p>
            <Check ok={data.tb.totals.debit === data.tb.totals.credit && data.tb.totals.closing === 0}>{t("Trial balance: debits equal credits ({amount})", { amount: amount(data.tb.totals.debit) })}</Check>
            <Check ok={data.bs.difference === 0}>{t("Balance sheet: assets equal liabilities plus equity")}</Check>
            <Check ok={data.cf.difference === 0}>{t("Cash flow statement ties to the change in cash")}</Check>
          </div>
        </Card>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-3">
        <Card>
          <CardHeader title={t("Cash by account")} icon={Banknote} meta={fmtDate(period.to)} />
          <ul className="divide-y divide-border">
            {data.cash.map((c) => (
              <li key={c.account.code}>
                <button onClick={() => go({ v: "ledger", a: c.account.code })} className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left hover:bg-surface-2">
                  <span className="min-w-0">
                    <span className="block truncate">{c.account.name[lang]}</span>
                    <span className="font-mono text-xs text-faint">{c.account.code}</span>
                  </span>
                  <span className="text-right">
                    <span className={cx("block", num)}>{money(c.base)}</span>
                    {c.fx !== null && c.account.currency && <span className="block font-mono text-xs text-muted">{money(c.fx, c.account.currency)}</span>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </Card>

        <Card>
          <CardHeader title={t("Receivables by age")} icon={FileText} meta={money(arTotal)} />
          <div className="space-y-3 p-4">
            {BUCKETS.map((b, i) => {
              const v = data.buckets[i];
              const max = Math.max(1, ...data.buckets);
              return (
                <div key={b}>
                  <div className="flex justify-between text-xs">
                    <span className="text-muted">{t(b)}</span>
                    <span className="font-mono tabular-nums">{money(v)}</span>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-3">
                    <div className={cx("h-full rounded-full transition-[width] duration-700", i === 0 ? "bg-accent" : i < 3 ? "bg-warning" : "bg-danger")} style={{ width: `${(v / max) * 100}%` }} />
                  </div>
                </div>
              );
            })}
            {overdue.slice(0, 3).map((r) => (
              <button key={r.doc.id} onClick={() => go({ v: "sales", d: r.doc.id })} className="flex w-full items-center justify-between gap-2 rounded-md border border-border px-2.5 py-2 text-left text-xs hover:bg-surface-2">
                <span className="min-w-0 truncate">
                  {r.doc.number} · {r.party?.name}
                </span>
                <Badge tone={r.days > 60 ? "danger" : "warning"}>{t("{n} days late", { n: r.days })}</Badge>
              </button>
            ))}
          </div>
        </Card>

        <Card>
          <CardHeader title={t("Latest entries")} icon={Scale} meta={<button onClick={() => go({ v: "journal" })} className="hover:text-text">{t("Journal")} →</button>} />
          <ul className="divide-y divide-border">
            {recent.map((e) => (
              <li key={e.id}>
                <button onClick={() => go({ v: "journal", e: e.id })} className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-surface-2">
                  <span className="w-12 shrink-0 font-mono text-xs text-faint">#{e.no}</span>
                  <span className="min-w-0 flex-1 truncate">{known(e.memo)}</span>
                  <span className={cx("shrink-0", num)}>{amount(sum(e.lines, "debit"))}</span>
                </button>
              </li>
            ))}
          </ul>
        </Card>
      </div>
      <p className="mt-4 text-xs text-faint">
        {t("Open invoices: {n}. Paid this period: {paid}.", { n: book.docs.filter((d) => d.kind === "invoice" && openAmount(d) > 0).length, paid: book.docs.filter((d) => d.kind === "invoice" && docStatus(d, today) === "paid" && d.date >= period.from).length })}
      </p>
    </>
  );
}

function Legend({ color, label, line }: { color: string; label: string; line?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={line ? "h-0.5 w-3 rounded" : "size-2 rounded-[2px]"} style={{ background: color }} />
      {label}
    </span>
  );
}

function Kpi({ icon: Icon, label, value, sub, spark, tone, onClick }: { icon: React.ComponentType<{ className?: string }>; label: string; value: string; sub: string; spark?: number[]; tone?: "danger"; onClick?: () => void }) {
  return (
    <button onClick={onClick} className="group rounded-lg border border-border bg-surface p-4 text-left shadow-card transition-colors hover:border-border-strong">
      <p className="flex items-center gap-1.5 text-xs text-muted">
        <Icon className="size-3.5" /> {label}
      </p>
      <p className="mt-2 text-[22px] leading-7 font-semibold tracking-[-0.02em] tabular-nums">{value}</p>
      <div className="mt-1 flex items-end justify-between gap-3">
        <p className={cx("min-w-0 text-xs", tone === "danger" ? "text-danger" : "text-muted")}>{sub}</p>
        {spark && <Sparkline data={spark} className="w-20 shrink-0" />}
      </div>
    </button>
  );
}
