"use client";

import { CalendarCheck, Lock, Repeat, Unlock } from "lucide-react";
import { useMemo, useState } from "react";
import { closeYear, settleVat, vatReport, yearResult } from "@/lib/close";
import { amount, date as fmtDate, money, monthName } from "@/lib/format";
import { useLang, useT } from "@/lib/i18n";
import { accountMap, addMonths, lockThrough, monthEnd, sum, unlock } from "@/lib/ledger";
import { dueMonths, runRecurring } from "@/lib/recurring";
import { go } from "@/lib/route";
import { useBook } from "../app";
import { Badge, Button, Card, CardHeader, PageHeader, cx, inputClass, num, td, th } from "../ui";

export function Close() {
  const t = useT();
  const { lang } = useLang();
  const { book, today, act } = useBook();
  const [lockDate, setLockDate] = useState(monthEnd(addMonths(today.slice(0, 7), -1)));
  const vat = useMemo(() => Array.from({ length: 12 }, (_, i) => vatReport(book, addMonths(today.slice(0, 7), -i - 1))), [book, today]);
  const years = [...new Set(book.entries.filter((e) => e.status === "posted").map((e) => Number(e.date.slice(0, 4))))].filter((y) => y < Number(today.slice(0, 4))).sort();
  const acc = accountMap(book);
  const due = book.recurring.map((r) => ({ r, months: dueMonths(r, today) }));
  const dueCount = due.reduce((a, d) => a + d.months.length, 0);

  return (
    <>
      <PageHeader title={t("Close and VAT")} description={t("Month-end and year-end work: settle VAT, run recurring entries, lock reviewed months and close the year into retained earnings.")} />
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        <Card>
          <CardHeader title={t("Period lock")} icon={Lock} meta={book.lockedThrough ? t("Locked through {date}", { date: fmtDate(book.lockedThrough) }) : t("Nothing locked")} />
          <div className="space-y-3 p-4">
            <p className="text-muted">{t("Nothing can be posted, edited or reversed on or before the lock date. Lock a month once it is reviewed; reports for it can't change after that.")}</p>
            <div className="flex flex-wrap items-end gap-2">
              <label className="space-y-1">
                <span className="block text-xs text-muted">{t("Lock through")}</span>
                <input type="date" value={lockDate} onChange={(e) => setLockDate(e.target.value)} className={cx(inputClass, "w-44")} />
              </label>
              <Button variant="primary" onClick={() => act((b) => lockThrough(b, lockDate), t("Locked through {date}.", { date: fmtDate(lockDate) }))}>
                <Lock /> {t("Lock")}
              </Button>
              {book.lockedThrough && (
                <Button variant="ghost" onClick={() => act((b) => unlock(b, b.closedYears.length ? `${Math.max(...b.closedYears)}-12-31` : null), t("Lock moved back."))}>
                  <Unlock /> {t("Unlock to the last closed year")}
                </Button>
              )}
            </div>
          </div>
        </Card>

        <Card>
          <CardHeader title={t("Recurring entries")} icon={Repeat} meta={dueCount ? t("{n} due", { n: dueCount }) : t("Up to date")} />
          <ul className="divide-y divide-border">
            {book.recurring.length === 0 && <li className="p-4 text-muted">{t("No recurring entries.")}</li>}
            {due.map(({ r, months: m }) => (
              <li key={r.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                <span className="min-w-0">
                  <span className="block truncate">{t(r.name)}</span>
                  <span className="block text-xs text-muted">
                    {t("Day {d} of each month · {amount}", { d: r.day, amount: money(sum(r.lines, "debit")) })} · {r.lines.map((l) => `${l.account} ${acc.get(l.account)?.name[lang] ?? ""}`).join(" / ")}
                  </span>
                </span>
                {m.length ? <Badge tone="warning">{t("{n} due", { n: m.length })}</Badge> : <Badge tone="success">{t("Last ran {m}", { m: r.last ? monthName(r.last, "short") : "—" })}</Badge>}
              </li>
            ))}
          </ul>
          {dueCount > 0 && (
            <div className="border-t border-border p-3">
              <Button variant="primary" onClick={() => act((b) => runRecurring(b, today).book, t("Recurring entries posted."))}>
                {t("Post {n} due entries", { n: dueCount })}
              </Button>
            </div>
          )}
        </Card>

        <Card className="xl:col-span-2">
          <CardHeader title={t("VAT by month")} icon={CalendarCheck} />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-[13px]">
              <thead className="border-b border-border">
                <tr>
                  <th className={th}>{t("Month")}</th>
                  <th className={cx(th, "text-right")}>{t("Output VAT")}</th>
                  <th className={cx(th, "text-right")}>{t("Input VAT")}</th>
                  <th className={cx(th, "text-right")}>{t("Brought forward")}</th>
                  <th className={cx(th, "text-right")}>{t("To pay")}</th>
                  <th className={cx(th, "text-right")}>{t("Carried forward")}</th>
                  <th className={th} />
                </tr>
              </thead>
              <tbody>
                {vat.map((r) => (
                  <tr key={r.month} className="border-b border-border last:border-0">
                    <td className={td}>{monthName(r.month)}</td>
                    <td className={cx(td, num)}>{amount(r.output)}</td>
                    <td className={cx(td, num)}>{amount(r.input)}</td>
                    <td className={cx(td, num)}>{amount(r.carriedIn)}</td>
                    <td className={cx(td, num, r.payable > 0 && "font-medium")}>{amount(r.payable)}</td>
                    <td className={cx(td, num)}>{amount(r.carriedOut)}</td>
                    <td className={cx(td, "text-right")}>
                      {r.settled ? (
                        <button onClick={() => go({ v: "journal", e: r.settled!.id })} className="text-xs text-accent hover:underline">
                          #{r.settled.no}
                        </button>
                      ) : r.output || r.input ? (
                        <Button size="sm" onClick={() => act((b) => settleVat(b, r.month).book, t("VAT for {month} settled.", { month: monthName(r.month) }))}>
                          {t("Settle")}
                        </Button>
                      ) : (
                        <span className="text-xs text-faint">{t("No VAT")}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card className="xl:col-span-2">
          <CardHeader title={t("Year-end close")} icon={Lock} />
          <div className="divide-y divide-border">
            {years.length === 0 && <p className="p-4 text-muted">{t("No earlier year has entries yet.")}</p>}
            {years.map((y) => {
              const closed = book.closedYears.includes(y);
              const res = closed ? null : yearResult(book, y);
              return (
                <div key={y} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <span className="w-14 font-medium">{y}</span>
                  {closed ? (
                    <Badge tone="success">{t("Closed and locked")}</Badge>
                  ) : (
                    <span className="text-muted">{t("Result to close: {amount}", { amount: money(res!.result) })}</span>
                  )}
                  {!closed && (
                    <Button className="ml-auto" variant="primary" onClick={() => act((b) => closeYear(b, y).book, t("{year} closed.", { year: y }))}>
                      {t("Close {year}", { year: y })}
                    </Button>
                  )}
                  {closed && (
                    <Button className="ml-auto" size="sm" variant="ghost" onClick={() => go({ v: "journal", q: `${y}` })}>
                      {t("See closing entries")}
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
          <p className="border-t border-border px-4 py-2.5 text-xs text-faint">{t("Closing moves every income and expense balance into the year's result, carries it to retained earnings on 1 January and locks the year.")}</p>
        </Card>
      </div>
    </>
  );
}
