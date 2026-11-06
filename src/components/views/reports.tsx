"use client";

import { ChevronRight, Download, FileSpreadsheet } from "lucide-react";
import { useMemo, useState } from "react";
import { vatReport } from "@/lib/close";
import { download, workbook } from "@/lib/export";
import { acct, amount, date as fmtDate, monthName, percent } from "@/lib/format";
import { useLang, useT } from "@/lib/i18n";
import { addDays, addMonths, dayBefore } from "@/lib/ledger";
import { go, useRoute } from "@/lib/route";
import { balanceSheet, cashFlow, incomeStatement, trialBalance, type StatementLine } from "@/lib/reports";
import { useBook } from "../app";
import { useToast } from "../toast";
import { Badge, Button, Card, Check, PageHeader, Segmented, cx, num, td, th } from "../ui";

type Tab = "tb" | "is" | "bs" | "cf" | "vat";
const TABS: { value: Tab; label: string }[] = [
  { value: "tb", label: "Trial balance" },
  { value: "is", label: "Income statement" },
  { value: "bs", label: "Balance sheet" },
  { value: "cf", label: "Cash flow" },
  { value: "vat", label: "VAT report" },
];

export function Reports() {
  const t = useT();
  const { toast } = useToast();
  const { book, period } = useBook();
  const route = useRoute();
  const tab = (TABS.some((x) => x.value === route.r) ? route.r : "is") as Tab;
  const [busy, setBusy] = useState(false);
  const excel = async () => {
    setBusy(true);
    try {
      download(await workbook(book, period.from, period.to), `${book.name.replace(/\W+/g, "-").toLowerCase()}-${period.from}-${period.to}.xlsx`);
      toast(t("Workbook ready: journal, trial balance, statements and aging."));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <PageHeader
        title={t("Reports")}
        description={t("{from} to {to}. Every figure comes from posted entries; click an account to see its ledger.", { from: fmtDate(period.from), to: fmtDate(period.to) })}
        actions={
          <Button onClick={excel} disabled={busy}>
            <FileSpreadsheet /> {t(busy ? "Building…" : "Excel workbook")}
          </Button>
        }
      />
      <Segmented value={tab} onChange={(v) => go({ v: "reports", r: v }, { replace: true })} label={t("Report")} options={TABS.map((x) => ({ value: x.value, label: t(x.label) }))} className="mb-3" />
      {tab === "tb" && <TrialBalanceView />}
      {tab === "is" && <IncomeView />}
      {tab === "bs" && <BalanceView />}
      {tab === "cf" && <CashFlowView />}
      {tab === "vat" && <VatView />}
    </>
  );
}

function AccountName({ code, name }: { code: string; name: string }) {
  return (
    <button onClick={() => go({ v: "ledger", a: code })} className="text-left hover:text-accent">
      <span className="font-mono text-xs text-muted">{code}</span> {name}
    </button>
  );
}

function TrialBalanceView() {
  const t = useT();
  const { lang } = useLang();
  const { book, period } = useBook();
  const tb = useMemo(() => trialBalance(book, period.from, period.to), [book, period]);
  const ok = tb.totals.debit === tb.totals.credit && tb.totals.closing === 0 && tb.totals.opening === 0;
  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2.5">
        <Check ok={ok}>{t(ok ? "In balance: debits equal credits, and opening and closing balances net to zero." : "Out of balance.")}</Check>
        <span className="text-xs text-muted">{t("{n} accounts with activity", { n: tb.rows.length })}</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-[13px]">
          <thead className="border-b border-border">
            <tr>
              <th className={th}>{t("Account")}</th>
              <th className={cx(th, "text-right")}>{t("Opening")}</th>
              <th className={cx(th, "text-right")}>{t("Debit")}</th>
              <th className={cx(th, "text-right")}>{t("Credit")}</th>
              <th className={cx(th, "text-right")}>{t("Closing")}</th>
            </tr>
          </thead>
          <tbody>
            {tb.rows.map((r) => (
              <tr key={r.account.code} className="border-b border-border hover:bg-surface-2">
                <td className={td}>
                  <AccountName code={r.account.code} name={r.account.name[lang]} />
                </td>
                <td className={cx(td, num)}>{acct(r.opening)}</td>
                <td className={cx(td, num)}>{amount(r.debit)}</td>
                <td className={cx(td, num)}>{amount(r.credit)}</td>
                <td className={cx(td, num)}>{acct(r.closing)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot className="bg-surface-2 font-medium">
            <tr>
              <td className={td}>{t("Total")}</td>
              <td className={cx(td, num)}>{acct(tb.totals.opening)}</td>
              <td className={cx(td, num)}>{amount(tb.totals.debit)}</td>
              <td className={cx(td, num)}>{amount(tb.totals.credit)}</td>
              <td className={cx(td, num)}>{acct(tb.totals.closing)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="px-4 py-2.5 text-xs text-faint">{t("Debit balances are positive, credit balances in parentheses. Year-end closing entries inside the period are left out, so income and expense accounts show their activity.")}</p>
    </Card>
  );
}

function Statement({ lines, compare, compareLabel, currentLabel }: { lines: StatementLine[]; compare?: StatementLine[]; compareLabel?: string; currentLabel?: string }) {
  const t = useT();
  const { lang } = useLang();
  const [open, setOpen] = useState<Set<string>>(new Set());
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] text-[13px]">
        {compare && (
          <thead className="border-b border-border">
            <tr>
              <th className={th} />
              <th className={cx(th, "w-40 text-right")}>{currentLabel}</th>
              <th className={cx(th, "w-40 text-right")}>{compareLabel}</th>
              <th className={cx(th, "w-24 text-right")}>{t("Change")}</th>
            </tr>
          </thead>
        )}
        <tbody>
          {lines.map((l) => {
            const prev = compare ? (compare.find((c) => c.key === l.key)?.amount ?? 0) : undefined;
            const has = (l.accounts?.length ?? 0) > 0;
            const isOpen = open.has(l.key);
            const change = prev !== undefined && prev !== 0 ? Math.round(((l.amount - prev) / Math.abs(prev)) * 100) : null;
            return (
              <FragmentRows key={l.key}>
                <tr className={cx("border-b border-border", l.total && "bg-surface-2 font-semibold")}>
                  <td className={td}>
                    {has ? (
                      <button onClick={() => setOpen((s) => (s.has(l.key) ? new Set([...s].filter((x) => x !== l.key)) : new Set([...s, l.key])))} aria-expanded={isOpen} className="inline-flex items-center gap-1 hover:text-accent">
                        <ChevronRight className={cx("size-3.5 text-muted transition-transform", isOpen && "rotate-90")} />
                        {t(l.label)}
                      </button>
                    ) : (
                      <span className={cx(!l.total && "pl-[18px]")}>{t(l.label)}</span>
                    )}
                  </td>
                  <td className={cx(td, num)}>{acct(l.amount)}</td>
                  {compare && <td className={cx(td, num, "text-muted")}>{prev !== undefined ? acct(prev) : ""}</td>}
                  {compare && <td className={cx(td, num, change === null ? "text-faint" : change >= 0 === (l.amount >= 0) ? "text-success" : "text-danger")}>{change === null ? "—" : `${change > 0 ? "+" : ""}${percent(change)}`}</td>}
                </tr>
                {isOpen &&
                  l.accounts!.map((a) => (
                    <tr key={a.account.code} className="border-b border-border text-muted">
                      <td className={cx(td, "pl-10")}>
                        <AccountName code={a.account.code} name={a.account.name[lang]} />
                      </td>
                      <td className={cx(td, num)}>{acct(a.amount)}</td>
                      {compare && <td />}
                      {compare && <td />}
                    </tr>
                  ))}
              </FragmentRows>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function FragmentRows({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

function IncomeView() {
  const t = useT();
  const { book, period } = useBook();
  const days = Math.round((Date.parse(period.to) - Date.parse(period.from)) / 86_400_000);
  const prevTo = dayBefore(period.from);
  const prevFrom = addDays(prevTo, -days);
  const is = useMemo(() => incomeStatement(book, period.from, period.to), [book, period]);
  const prev = useMemo(() => incomeStatement(book, prevFrom, prevTo), [book, prevFrom, prevTo]);
  const margin = is.revenue ? Math.round((is.net / is.revenue) * 100) : 0;
  return (
    <Card>
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2.5 text-xs text-muted">
        <Badge tone={is.net >= 0 ? "success" : "danger"}>{t(is.net >= 0 ? "Profit" : "Loss")}</Badge>
        {t("Net margin {m}", { m: percent(margin) })}
        <span className="ml-auto">{t("Compared with {from} to {to}", { from: fmtDate(prevFrom), to: fmtDate(prevTo) })}</span>
      </div>
      <Statement lines={is.lines} compare={prev.lines} currentLabel={t("This period")} compareLabel={t("Previous period")} />
    </Card>
  );
}

function BalanceView() {
  const t = useT();
  const { book, period } = useBook();
  const bs = useMemo(() => balanceSheet(book, period.to), [book, period.to]);
  const prevDate = `${Number(period.to.slice(0, 4)) - 1}-12-31`;
  const prev = useMemo(() => balanceSheet(book, prevDate), [book, prevDate]);
  const side = (lines: StatementLine[], total: { key: string; label: string; amount: number }) => [...lines, { ...total, level: 0 as const, total: true }];
  return (
    <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
      <Card>
        <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
          <h2 className="font-medium">{t("Assets")}</h2>
          <span className="text-xs text-muted">{fmtDate(period.to)}</span>
        </div>
        <Statement lines={side(bs.assets, { key: "ta", label: "Total assets", amount: bs.totalAssets })} compare={side(prev.assets, { key: "ta", label: "Total assets", amount: prev.totalAssets })} currentLabel={fmtDate(period.to)} compareLabel={fmtDate(prevDate)} />
      </Card>
      <Card>
        <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
          <h2 className="font-medium">{t("Liabilities and equity")}</h2>
          <Check ok={bs.difference === 0}>{t(bs.difference === 0 ? "Balances" : "Doesn't balance")}</Check>
        </div>
        <Statement
          lines={side([...bs.liabilities, ...bs.equity], { key: "tle", label: "Total liabilities and equity", amount: bs.totalLiabilities + bs.totalEquity })}
          compare={side([...prev.liabilities, ...prev.equity], { key: "tle", label: "", amount: prev.totalLiabilities + prev.totalEquity })}
          currentLabel={fmtDate(period.to)}
          compareLabel={fmtDate(prevDate)}
        />
      </Card>
    </div>
  );
}

function CashFlowView() {
  const t = useT();
  const { book, period } = useBook();
  const cf = useMemo(() => cashFlow(book, period.from, period.to), [book, period]);
  return (
    <Card>
      <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-2.5">
        <Check ok={cf.difference === 0}>{t(cf.difference === 0 ? "Ties out: opening cash plus the flows equals closing cash." : "Doesn't tie to the change in cash.")}</Check>
        <span className="ml-auto text-xs text-muted">{t("Indirect method")}</span>
      </div>
      <Statement lines={cf.lines} />
    </Card>
  );
}

function VatView() {
  const t = useT();
  const { book, today } = useBook();
  const months = Array.from({ length: 12 }, (_, i) => addMonths(today.slice(0, 7), -i));
  const [month, setMonth] = useState(months[1]);
  const r = useMemo(() => vatReport(book, month), [book, month]);
  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
      <Card className="lg:col-span-1">
        <div className="border-b border-border px-4 py-2.5">
          <label className="text-xs text-muted" htmlFor="vat-month">
            {t("Month")}
          </label>
          <select id="vat-month" value={month} onChange={(e) => setMonth(e.target.value)} className="mt-1 block h-8 w-full rounded-md border border-border bg-surface px-2">
            {months.map((m) => (
              <option key={m} value={m}>
                {monthName(m)}
              </option>
            ))}
          </select>
        </div>
        <dl className="divide-y divide-border">
          {[
            [t("Output VAT on sales"), r.output],
            [t("Input VAT on purchases"), -r.input],
            [t("Carried forward from last month"), -r.carriedIn],
          ].map(([l, v]) => (
            <div key={l as string} className="flex justify-between px-4 py-2.5">
              <dt className="text-muted">{l}</dt>
              <dd className={num}>{acct(v as number)}</dd>
            </div>
          ))}
          <div className="flex justify-between bg-surface-2 px-4 py-2.5 font-semibold">
            <dt>{t(r.payable ? "VAT to pay" : "Carried to next month")}</dt>
            <dd className={num}>{amount(r.payable || r.carriedOut)}</dd>
          </div>
        </dl>
        <div className="px-4 py-3">
          {r.settled ? (
            <button onClick={() => go({ v: "journal", e: r.settled!.id })} className="text-xs text-accent hover:underline">
              {t("Settled in entry #{n}", { n: r.settled.no ?? "" })}
            </button>
          ) : (
            <Button size="sm" onClick={() => go({ v: "close" })}>
              {t("Settle in Close and VAT")}
            </Button>
          )}
        </div>
      </Card>
      <Card className="lg:col-span-2">
        <div className="border-b border-border px-4 py-2.5 font-medium">{t("For the declaration (KDV beyannamesi)")}</div>
        <div className="grid grid-cols-1 gap-0 md:grid-cols-2">
          {(["sales", "purchases"] as const).map((k) => (
            <div key={k} className="border-border p-4 md:border-r md:last:border-r-0">
              <p className="mb-2 text-xs font-medium text-muted">{t(k === "sales" ? "Sales by rate" : "Purchases by rate")}</p>
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="text-xs text-muted">
                    <th className="py-1 text-left font-medium">{t("Rate")}</th>
                    <th className="py-1 text-right font-medium">{t("Base")}</th>
                    <th className="py-1 text-right font-medium">{t("VAT")}</th>
                  </tr>
                </thead>
                <tbody>
                  {r[k].length === 0 && (
                    <tr>
                      <td colSpan={3} className="py-2 text-muted">
                        {t("None this month")}
                      </td>
                    </tr>
                  )}
                  {r[k].map((x) => (
                    <tr key={x.rate} className="border-t border-border">
                      <td className="py-1.5">{x.rate ? percent(x.rate) : t("exempt (export)")}</td>
                      <td className={cx("py-1.5", num)}>{amount(x.net)}</td>
                      <td className={cx("py-1.5", num)}>{amount(x.vat)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
        <p className="border-t border-border px-4 py-2.5 text-xs text-faint">{t("Bases are converted at each document's rate. Export of services is exempt, so input VAT on costs is usually carried forward.")}</p>
      </Card>
      <div className="lg:col-span-3">
        <Button variant="ghost" size="sm" onClick={() => go({ v: "journal", q: "VAT" })}>
          <Download /> {t("Find VAT entries in the journal")}
        </Button>
      </div>
    </div>
  );
}
