"use client";

import { Archive, ArchiveRestore, Plus } from "lucide-react";
import { useMemo, useState } from "react";
import type { Account, AccountType, Section } from "@/lib/charts";
import { amount } from "@/lib/format";
import { useLang, useT } from "@/lib/i18n";
import { parentCode } from "@/lib/charts";
import { LedgerError, balances, natural, sortedAccounts } from "@/lib/ledger";
import { go } from "@/lib/route";
import { useBook } from "../app";
import { TYPE_PLURAL } from "../entry-editor";
import { Badge, Button, Card, Field, Modal, PageHeader, cx, inputClass, num } from "../ui";

const SECTIONS: Record<AccountType, Section[]> = {
  asset: ["cash", "receivables", "tax-assets", "other-current-assets", "fixed-assets"],
  liability: ["current-liabilities", "long-term-liabilities"],
  equity: ["equity"],
  income: ["revenue", "other-income"],
  expense: ["cost-of-sales", "operating-expenses", "other-expenses", "income-tax"],
};

export const SECTION_LABEL: Record<Section, string> = {
  cash: "Cash and banks",
  receivables: "Trade receivables",
  "tax-assets": "VAT and tax assets",
  "other-current-assets": "Other current assets",
  "fixed-assets": "Fixed assets",
  "current-liabilities": "Current liabilities",
  "long-term-liabilities": "Long-term liabilities",
  equity: "Equity",
  revenue: "Revenue",
  "cost-of-sales": "Cost of sales",
  "operating-expenses": "Operating expenses",
  "other-income": "Other income",
  "other-expenses": "Other expenses",
  "income-tax": "Income tax",
};

export function Accounts() {
  const t = useT();
  const { lang } = useLang();
  const { book, period, act } = useBook();
  const [adding, setAdding] = useState(false);
  const bal = useMemo(() => balances(book, { to: period.to }), [book, period.to]);
  const used = useMemo(() => new Set(book.entries.flatMap((e) => e.lines.map((l) => l.account))), [book.entries]);
  const accounts = sortedAccounts(book);

  const archive = (a: Account, archived: boolean) =>
    act(
      (b) => {
        if (archived && natural(a, bal.get(a.code)) !== 0) throw new LedgerError("archive-balance", "An account with a balance can't be archived.");
        return { ...b, accounts: b.accounts.map((x) => (x.code === a.code ? { ...x, archived } : x)), audit: [{ at: new Date().toISOString(), action: "account", target: a.code, detail: archived ? "archived" : "restored" }, ...b.audit] };
      },
      t(archived ? "Account archived." : "Account restored."),
    );

  return (
    <>
      <PageHeader
        title={t("Chart of accounts")}
        description={t(book.chart === "tdhp" ? "The Turkish uniform chart of accounts (Tekdüzen Hesap Planı), with the accounts a service company uses. Balances as of {date}." : "A compact international chart. Balances as of {date}.", { date: period.to })}
        actions={
          <Button variant="primary" onClick={() => setAdding(true)}>
            <Plus /> {t("New account")}
          </Button>
        }
      />
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        {(["asset", "liability", "equity", "income", "expense"] as const).map((type) => (
          <Card key={type}>
            <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
              <h2 className="font-medium">{t(TYPE_PLURAL[type])}</h2>
              <span className="text-xs text-muted">{t(type === "asset" || type === "expense" ? "Debit balances" : "Credit balances")}</span>
            </div>
            <ul className="divide-y divide-border">
              {accounts
                .filter((a) => a.type === type)
                .map((a) => {
                  const v = natural(a, bal.get(a.code));
                  const child = !!parentCode(a.code);
                  return (
                    <li key={a.code} className={cx("group flex items-center gap-3 px-4 py-2", a.archived && "opacity-50")}>
                      <button onClick={() => !a.header && go({ v: "ledger", a: a.code })} disabled={a.header} className={cx("flex min-w-0 flex-1 items-center gap-3 text-left", !a.header && "hover:text-accent", child && "pl-5")}>
                        <span className="w-16 shrink-0 font-mono text-xs text-muted">{a.code}</span>
                        <span className={cx("min-w-0 truncate", a.header && "font-medium")}>{a.name[lang]}</span>
                        {a.currency && <Badge>{a.currency}</Badge>}
                        {a.contra && <Badge>{t("contra")}</Badge>}
                        {a.custom && <Badge tone="accent">{t("added")}</Badge>}
                      </button>
                      {!a.header && <span className={cx(num, v < 0 && "text-danger", !v && "text-faint")}>{amount(v)}</span>}
                      {a.custom && !a.header && (
                        <button onClick={() => archive(a, !a.archived)} className="rounded p-1 text-faint opacity-0 group-hover:opacity-100 hover:text-text focus:opacity-100" aria-label={t(a.archived ? "Restore account {code}" : "Archive account {code}", { code: a.code })}>
                          {a.archived ? <ArchiveRestore className="size-3.5" /> : <Archive className="size-3.5" />}
                        </button>
                      )}
                      {!a.custom && !a.header && !used.has(a.code) && <span className="sr-only">{t("unused")}</span>}
                    </li>
                  );
                })}
            </ul>
          </Card>
        ))}
      </div>
      {adding && <NewAccount onClose={() => setAdding(false)} />}
    </>
  );
}

function NewAccount({ onClose }: { onClose: () => void }) {
  const t = useT();
  const { book, act } = useBook();
  const [code, setCode] = useState("");
  const [en, setEn] = useState("");
  const [tr, setTr] = useState("");
  const [type, setType] = useState<AccountType>("expense");
  const [section, setSection] = useState<Section>("operating-expenses");
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    const c = code.trim();
    let err: string | null = null;
    if (!/^[0-9][0-9.]{1,11}$/.test(c)) err = t("Use digits, with dots for sub-accounts (770.08).");
    else if (book.accounts.some((a) => a.code === c)) err = t("Account {code} already exists.", { code: c });
    else if (parentCode(c) && !book.accounts.some((a) => a.code === parentCode(c))) err = t("There is no heading {code} to put it under.", { code: parentCode(c)! });
    else if (!en.trim() && !tr.trim()) err = t("Give the account a name.");
    setError(err);
    if (err) return;
    const parent = parentCode(c);
    const ok = act(
      (b) => {
        // A main account that gets its first sub-account becomes a heading, unless entries already use it.
        if (parent) {
          const p = b.accounts.find((a) => a.code === parent)!;
          if (!p.header && b.entries.some((e) => e.lines.some((l) => l.account === parent)))
            throw new LedgerError("parent-postable", "{code} already has postings; add the new account next to it instead.", { code: parent });
        }
        return {
          ...b,
          accounts: [...b.accounts.map((a) => (a.code === parent ? { ...a, header: true } : a)), { code: c, name: { en: en.trim() || tr.trim(), tr: tr.trim() || en.trim() }, type, section, custom: true }],
          audit: [{ at: new Date().toISOString(), action: "account", target: c, detail: "created" }, ...b.audit],
        };
      },
      t("Account {code} added.", { code: c }),
    );
    if (ok) onClose();
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={t("New account")}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t("Cancel")}
          </Button>
          <Button variant="primary" onClick={submit}>
            {t("Add account")}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label={t("Code")} error={error ?? undefined} hint={t(book.chart === "tdhp" ? "Under a heading: 770.08. A new main account: 659." : "Four digits, in the range of its type: 6080.")}>
          {(id, d) => <input id={id} aria-describedby={d} value={code} onChange={(e) => setCode(e.target.value)} className={cx(inputClass, "font-mono")} inputMode="decimal" />}
        </Field>
        <Field label={t("Name in English")}>{(id) => <input id={id} value={en} onChange={(e) => setEn(e.target.value)} className={inputClass} maxLength={80} />}</Field>
        <Field label={t("Name in Turkish")}>{(id) => <input id={id} value={tr} onChange={(e) => setTr(e.target.value)} className={inputClass} maxLength={80} />}</Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("Type")}>
            {(id) => (
              <select
                id={id}
                value={type}
                onChange={(e) => {
                  const v = e.target.value as AccountType;
                  setType(v);
                  setSection(SECTIONS[v][0]);
                }}
                className={inputClass}
              >
                {(Object.keys(SECTIONS) as AccountType[]).map((k) => (
                  <option key={k} value={k}>
                    {t(TYPE_PLURAL[k])}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label={t("Report section")}>
            {(id) => (
              <select id={id} value={section} onChange={(e) => setSection(e.target.value as Section)} className={inputClass}>
                {SECTIONS[type].map((s) => (
                  <option key={s} value={s}>
                    {t(SECTION_LABEL[s])}
                  </option>
                ))}
              </select>
            )}
          </Field>
        </div>
      </div>
    </Modal>
  );
}
