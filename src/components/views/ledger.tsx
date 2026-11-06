"use client";

import { Rows3 } from "lucide-react";
import { useMemo } from "react";
import { amount, cell, date as fmtDate, money } from "@/lib/format";
import { useKnown, useLang, useT } from "@/lib/i18n";
import { sortedAccounts } from "@/lib/ledger";
import { go, useRoute } from "@/lib/route";
import { accountLedger } from "@/lib/reports";
import { useBook } from "../app";
import { TYPE_PLURAL } from "../entry-editor";
import { Card, EmptyState, PageHeader, cx, inputClass, num, td, th } from "../ui";

export function Ledger() {
  const t = useT();
  const known = useKnown();
  const { lang } = useLang();
  const { book, period } = useBook();
  const route = useRoute();
  const accounts = useMemo(() => sortedAccounts(book).filter((a) => !a.header), [book]);
  const code = route.a && accounts.some((a) => a.code === route.a) ? route.a : accounts.find((a) => a.role === "bank-try")?.code ?? accounts[0].code;
  const led = useMemo(() => accountLedger(book, code, period.from, period.to), [book, code, period]);
  const a = led.account;
  const fx = a.currency && a.currency !== "TRY";

  return (
    <>
      <PageHeader
        title={t("General ledger")}
        description={t("Every posting to one account, with a running balance in the account's natural direction.")}
        actions={
          <select value={code} onChange={(e) => go({ v: "ledger", a: e.target.value }, { replace: true })} aria-label={t("Account")} className={cx(inputClass, "w-72")}>
            {(["asset", "liability", "equity", "income", "expense"] as const).map((type) => (
              <optgroup key={type} label={t(TYPE_PLURAL[type])}>
                {accounts
                  .filter((x) => x.type === type)
                  .map((x) => (
                    <option key={x.code} value={x.code}>
                      {x.code} · {x.name[lang]}
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>
        }
      />
      <div className="mb-3 grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          [t("Opening balance"), led.opening],
          [t("Debits"), led.debit],
          [t("Credits"), led.credit],
          [t("Closing balance"), led.closing],
        ].map(([label, v]) => (
          <div key={label as string} className="rounded-lg border border-border bg-surface p-3 shadow-card">
            <p className="text-xs text-muted">{label}</p>
            <p className="mt-1 font-mono text-[15px] font-medium tabular-nums">{amount(v as number)}</p>
          </div>
        ))}
      </div>
      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
          <span className="font-mono text-xs text-muted">{a.code}</span>
          <span className="font-medium">{a.name[lang]}</span>
          <span className="text-xs text-faint">· {t(TYPE_PLURAL[a.type])}{a.contra ? ` · ${t("contra account")}` : ""}</span>
        </div>
        {led.rows.length === 0 ? (
          <EmptyState icon={Rows3} title={t("No postings in this period")} text={t("Choose a longer period or another account.")} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-[13px]">
              <thead className="border-b border-border">
                <tr>
                  <th className={cx(th, "w-28")}>{t("Date")}</th>
                  <th className={cx(th, "w-16")}>{t("No")}</th>
                  <th className={th}>{t("Description")}</th>
                  {fx && <th className={cx(th, "text-right")}>{a.currency}</th>}
                  <th className={cx(th, "w-32 text-right")}>{t("Debit")}</th>
                  <th className={cx(th, "w-32 text-right")}>{t("Credit")}</th>
                  <th className={cx(th, "w-36 text-right")}>{t("Balance")}</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-border bg-surface-2/60 text-muted">
                  <td className={td} colSpan={fx ? 6 : 5}>
                    {t("Opening balance on {date}", { date: fmtDate(period.from) })}
                  </td>
                  <td className={cx(td, num)}>{amount(led.opening)}</td>
                </tr>
                {led.rows.map((r, i) => (
                  <tr key={i} onClick={() => go({ v: "journal", e: r.entry.id })} className="cursor-pointer border-b border-border last:border-0 hover:bg-surface-2">
                    <td className={cx(td, "whitespace-nowrap text-muted")}>{fmtDate(r.entry.date)}</td>
                    <td className={cx(td, "font-mono text-xs text-muted")}>#{r.entry.no}</td>
                    <td className={cx(td, "max-w-0")}>
                      <p className="truncate">{known(r.memo)}</p>
                    </td>
                    {fx && <td className={cx(td, num, "text-muted")}>{r.fx ? money(r.fx.amount, r.fx.currency) : ""}</td>}
                    <td className={cx(td, num)}>{cell(r.debit)}</td>
                    <td className={cx(td, num)}>{cell(r.credit)}</td>
                    <td className={cx(td, num, r.balance < 0 && "text-danger")}>{amount(r.balance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
