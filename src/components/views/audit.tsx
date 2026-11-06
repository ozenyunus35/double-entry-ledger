"use client";

import { History } from "lucide-react";
import { useMemo, useState } from "react";
import { useKnown, useLang, useT } from "@/lib/i18n";
import { useBook } from "../app";
import { Badge, Card, EmptyState, PageHeader, cx, inputClass, td, th, type Tone } from "../ui";

const ACTION: Record<string, [string, Tone]> = {
  create: ["Draft created", "neutral"],
  edit: ["Draft edited", "neutral"],
  post: ["Posted", "success"],
  delete: ["Draft deleted", "warning"],
  reverse: ["Reversed", "danger"],
  lock: ["Period locked", "info"],
  unlock: ["Period unlocked", "warning"],
  "close-year": ["Year closed", "info"],
  revalue: ["FX revaluation", "info"],
  import: ["Import", "accent"],
  invoice: ["Invoice issued", "success"],
  bill: ["Bill recorded", "success"],
  payment: ["Payment", "success"],
  vat: ["VAT settled", "info"],
  recurring: ["Recurring", "neutral"],
  account: ["Account changed", "neutral"],
  reset: ["Reset", "warning"],
};

export function Audit() {
  const t = useT();
  const known = useKnown();
  const { lang } = useLang();
  const { book } = useBook();
  const [q, setQ] = useState("");
  /** "#12 Payroll 2026-03": the number stays, the description is translated. */
  const targetText = (target: string) => {
    const m = /^(#\d+) (.*)$/.exec(target);
    return m ? `${m[1]} ${known(m[2])}` : known(target);
  };
  const rows = useMemo(() => {
    const s = q.trim().toLocaleLowerCase("tr");
    return book.audit.filter((a) => !s || `${a.target} ${known(a.target)} ${a.action} ${a.detail ?? ""}`.toLocaleLowerCase("tr").includes(s)).slice(0, 300);
  }, [book.audit, q, known]);
  return (
    <>
      <PageHeader title={t("Audit log")} description={t("Every change to these books, newest first. The log is kept with the books and can't be edited from the app.")} />
      <Card>
        <div className="border-b border-border p-3">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Search the log")} aria-label={t("Search the log")} className={cx(inputClass, "max-w-sm")} />
        </div>
        {rows.length === 0 ? (
          <EmptyState icon={History} title={t("Nothing logged")} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-[13px]">
              <thead className="border-b border-border">
                <tr>
                  <th className={cx(th, "w-44")}>{t("When")}</th>
                  <th className={cx(th, "w-44")}>{t("Event")}</th>
                  <th className={th}>{t("About")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((a, i) => {
                  const [label, tone] = ACTION[a.action] ?? [a.action, "neutral" as Tone];
                  return (
                    <tr key={i} className="border-b border-border last:border-0">
                      <td className={cx(td, "whitespace-nowrap text-muted")}>{new Date(a.at).toLocaleString(lang === "tr" ? "tr-TR" : "en-US", { dateStyle: "medium", timeStyle: "short" })}</td>
                      <td className={td}>
                        <Badge tone={tone}>{t(label)}</Badge>
                      </td>
                      <td className={cx(td, "max-w-0")}>
                        <p className="truncate">
                          {targetText(a.target)}
                          {a.detail && a.action !== "close-year" && a.action !== "revalue" && <span className="ml-2 text-xs text-muted">{t(a.detail)}</span>}
                        </p>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
