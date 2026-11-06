"use client";

import { ArrowLeftRight, Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { amount, date as fmtDate, money, monthName, rate as fmtRate } from "@/lib/format";
import { fxPositions, rateOn, revaluationPreview, revalue } from "@/lib/fx";
import { useLang, useT } from "@/lib/i18n";
import { parseRate } from "@/lib/importer";
import { LedgerError, accountMap, addMonths, monthEnd, validDate } from "@/lib/ledger";
import type { Currency } from "@/lib/money";
import { go } from "@/lib/route";
import { useBook } from "../app";
import { Button, Card, CardHeader, EmptyState, PageHeader, Sparkline, cx, inputClass, num, td, th } from "../ui";

const FOREIGN: Currency[] = ["EUR", "USD", "GBP"];

export function Currencies() {
  const t = useT();
  const { lang } = useLang();
  const { book, today, act } = useBook();
  const months = Array.from({ length: 6 }, (_, i) => addMonths(today.slice(0, 7), -i - 1));
  const [month, setMonth] = useState(() => months.find((m) => !book.entries.some((e) => e.source === "revaluation" && e.date === monthEnd(m) && e.status === "posted")) ?? months[0]);
  const end = monthEnd(month);
  const preview = useMemo(() => revaluationPreview(book, end), [book, end]);
  const done = book.entries.find((e) => e.status === "posted" && e.source === "revaluation" && e.date === end);
  const acc = accountMap(book);
  const positions = useMemo(() => [...fxPositions(book, today).values()].filter((p) => p.fx !== 0 && acc.get(p.account)?.monetary), [book, today, acc]);
  const [cur, setCur] = useState<Currency>("EUR");
  const [date, setDate] = useState(today);
  const [value, setValue] = useState("");
  const net = preview.reduce((a, r) => a + r.difference, 0);

  const addRate = () => {
    const r = parseRate(value);
    act((b) => {
      if (!validDate(date)) throw new LedgerError("bad-date", "The date {date} is not a real calendar day.", { date });
      if (!(r > 0) || r > 100000) throw new LedgerError("bad-rate", "Enter a rate above zero, like 50.1234.");
      return { ...b, rates: [...b.rates.filter((x) => !(x.currency === cur && x.date === date)), { date, currency: cur, rate: r }] };
    }, t("Rate saved."));
    setValue("");
  };

  return (
    <>
      <PageHeader title={t("Currencies")} description={t("The lira is the base currency. Foreign amounts keep their own balance and are restated at month-end rates; differences go to exchange gains and losses.")} />
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {FOREIGN.map((c) => {
          const series = Array.from({ length: 90 }, (_, i) => rateOn(book, c, new Date(Date.parse(today) - (89 - i) * 86_400_000).toISOString().slice(0, 10))).filter((x): x is number => x !== null);
          const latest = rateOn(book, c, today);
          const first = series[0];
          return (
            <Card key={c} className="p-4">
              <p className="text-xs text-muted">{c} / TRY</p>
              <p className="mt-1 font-mono text-[22px] font-semibold tabular-nums">{latest ? fmtRate(latest) : "—"}</p>
              <div className="mt-1 flex items-end justify-between gap-3">
                <p className="text-xs text-muted">{latest && first ? t("{change} in 90 days", { change: `${latest >= first ? "+" : ""}${(((latest - first) / first) * 100).toFixed(1)}%` }) : t("No rates yet")}</p>
                <Sparkline data={series} className="w-24" />
              </div>
            </Card>
          );
        })}
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 xl:grid-cols-5">
        <Card className="xl:col-span-3">
          <CardHeader title={t("Month-end revaluation")} icon={ArrowLeftRight} meta={done ? t("Posted as #{n}", { n: done.no ?? "" }) : undefined} />
          <div className="flex flex-wrap items-end gap-2 border-b border-border p-3">
            <label className="space-y-1">
              <span className="block text-xs text-muted">{t("Month")}</span>
              <select value={month} onChange={(e) => setMonth(e.target.value)} className={cx(inputClass, "w-48")}>
                {months.map((m) => (
                  <option key={m} value={m}>
                    {monthName(m)}
                  </option>
                ))}
              </select>
            </label>
            <p className="pb-1.5 text-xs text-muted">{t("Rates on {date}: {rates}", { date: fmtDate(end), rates: FOREIGN.map((c) => `${c} ${rateOn(book, c, end) ? fmtRate(rateOn(book, c, end)!) : "—"}`).join(" · ") })}</p>
            {!done && preview.length > 0 && (
              <Button variant="primary" className="ml-auto" onClick={() => act((b) => revalue(b, end).book, t("Revaluation posted."))}>
                {t("Post revaluation")}
              </Button>
            )}
            {done && (
              <Button className="ml-auto" onClick={() => go({ v: "journal", e: done.id })}>
                {t("Open entry")}
              </Button>
            )}
          </div>
          {done ? (
            <p className="p-4 text-muted">{t("Balances for this month are already restated. Reverse the entry to redo it.")}</p>
          ) : preview.length === 0 ? (
            <EmptyState icon={ArrowLeftRight} title={t("Nothing to revalue")} text={t("Foreign balances already sit at this month's closing rate.")} />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[620px] text-[13px]">
                <thead className="border-b border-border">
                  <tr>
                    <th className={th}>{t("Account")}</th>
                    <th className={cx(th, "text-right")}>{t("Foreign balance")}</th>
                    <th className={cx(th, "text-right")}>{t("Carried at")}</th>
                    <th className={cx(th, "text-right")}>{t("At closing rate")}</th>
                    <th className={cx(th, "text-right")}>{t("Difference")}</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.map((r) => (
                    <tr key={`${r.account}${r.currency}`} className="border-b border-border">
                      <td className={td}>
                        <span className="font-mono text-xs text-muted">{r.account}</span> {acc.get(r.account)?.name[lang]}
                      </td>
                      <td className={cx(td, num)}>{money(r.fx, r.currency)}</td>
                      <td className={cx(td, num)}>{amount(r.carried)}</td>
                      <td className={cx(td, num)}>{amount(r.target)}</td>
                      <td className={cx(td, num, r.difference > 0 ? "text-success" : "text-danger")}>{r.difference > 0 ? "+" : ""}{amount(r.difference)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-surface-2 font-medium">
                  <tr>
                    <td className={td} colSpan={4}>
                      {t(net >= 0 ? "Unrealised exchange gain" : "Unrealised exchange loss")}
                    </td>
                    <td className={cx(td, num, net >= 0 ? "text-success" : "text-danger")}>{amount(Math.abs(net))}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </Card>

        <div className="space-y-3 xl:col-span-2">
          <Card>
            <CardHeader title={t("Open foreign balances")} meta={fmtDate(today)} />
            <ul className="divide-y divide-border">
              {positions.length === 0 && <li className="p-4 text-muted">{t("None.")}</li>}
              {positions.map((p) => (
                <li key={`${p.account}${p.currency}`} className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <span className="min-w-0 truncate">
                    <span className="font-mono text-xs text-muted">{p.account}</span> {acc.get(p.account)?.name[lang]}
                  </span>
                  <span className="text-right">
                    <span className={cx("block", num)}>{money(p.fx, p.currency)}</span>
                    <span className="block font-mono text-xs text-muted">{t("at {rate}", { rate: fmtRate(p.base / p.fx) })}</span>
                  </span>
                </li>
              ))}
            </ul>
          </Card>
          <Card className="p-4">
            <p className="font-medium">{t("Add or correct a rate")}</p>
            <div className="mt-3 grid grid-cols-[5rem_1fr_1fr] gap-2">
              <select value={cur} onChange={(e) => setCur(e.target.value as Currency)} aria-label={t("Currency")} className={inputClass}>
                {FOREIGN.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label={t("Date")} className={inputClass} />
              <input value={value} onChange={(e) => setValue(e.target.value)} placeholder="50,1234" inputMode="decimal" aria-label={t("Rate")} className={cx(inputClass, "font-mono")} />
            </div>
            <Button size="sm" className="mt-2" onClick={addRate} disabled={!value.trim()}>
              <Plus /> {t("Save rate")}
            </Button>
            <p className="mt-2 text-xs text-faint">{t("Demo rates are synthetic, a smooth path near where the lira traded. Enter the central bank's rate for real books.")}</p>
          </Card>
        </div>
      </div>
    </>
  );
}
