"use client";

import { BookOpen, Download, Link2, Pencil, Plus, RotateCcw, Send, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { journalCsv, SOURCE, download } from "@/lib/export";
import { amount, cell, date as fmtDate, money, rate as fmtRate } from "@/lib/format";
import { useKnown, useLang, useT } from "@/lib/i18n";
import { accountMap, addDays, deleteDraft, postDraft, reverseEntry, sum, validateEntry } from "@/lib/ledger";
import { go, shareUrl, useRoute } from "@/lib/route";
import type { Entry } from "@/lib/types";
import { useBook } from "../app";
import { useToast } from "../toast";
import { Badge, Button, Card, Drawer, EmptyState, PageHeader, Segmented, cx, inputClass, num, td, th } from "../ui";

type Status = "all" | "posted" | "draft" | "reversed";

const fold = (s: string) => s.toLocaleLowerCase("tr").normalize("NFD").replace(/\p{M}/gu, "").replace(/ı/g, "i");

export function Journal() {
  const t = useT();
  const known = useKnown();
  const { book, period, edit } = useBook();
  const route = useRoute();
  const [q, setQ] = useState(route.q?.startsWith("status:") ? "" : (route.q ?? ""));
  const [status, setStatus] = useState<Status>(route.q === "status:draft" ? "draft" : "all");
  const [source, setSource] = useState("");
  const [limit, setLimit] = useState(60);
  const acc = useMemo(() => accountMap(book), [book]);

  const rows = useMemo(() => {
    const words = fold(q.trim()).split(/\s+/).filter(Boolean);
    return book.entries
      .filter((e) => (e.status === "draft" ? true : e.date >= period.from && e.date <= period.to))
      .filter((e) => status === "all" || (status === "draft" ? e.status === "draft" : status === "reversed" ? !!e.reversedBy || !!e.reverses : e.status === "posted"))
      .filter((e) => !source || e.source === source)
      .filter((e) => {
        if (!words.length) return true;
        const hay = fold(`${e.no ?? ""} ${e.memo} ${known(e.memo)} ${e.ref ?? ""} ${e.date} ${e.lines.map((l) => `${l.account} ${acc.get(l.account)?.name.en} ${acc.get(l.account)?.name.tr} ${l.memo ?? ""} ${amount(l.debit || l.credit)} ${(l.debit || l.credit) / 100}`).join(" ")}`);
        return words.every((w) => hay.includes(w));
      })
      .sort((a, b) => (a.status === b.status ? b.date.localeCompare(a.date) || (b.no ?? 0) - (a.no ?? 0) : a.status === "draft" ? -1 : 1));
  }, [book.entries, period, status, source, q, acc, known]);

  const open = route.e ? book.entries.find((e) => e.id === route.e) : undefined;
  const postedCount = book.entries.filter((e) => e.status === "posted").length;
  const drafts = book.entries.filter((e) => e.status === "draft").length;

  return (
    <>
      <PageHeader
        title={t("Journal")}
        description={t("{n} posted entries · {d} drafts. Every entry balances to the kuruş; posted entries are never edited, only reversed.", { n: postedCount, d: drafts })}
        actions={
          <>
            <Button onClick={() => download(new Blob([journalCsv(book, period.from, period.to)], { type: "text/csv" }), `journal-${period.from}-${period.to}.csv`)}>
              <Download /> CSV
            </Button>
            <Button variant="primary" onClick={() => edit(null)}>
              <Plus /> {t("New entry")}
            </Button>
          </>
        }
      />
      <Card>
        <div className="flex flex-col gap-2 border-b border-border p-3 lg:flex-row lg:items-center">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Search description, reference, account or amount")} aria-label={t("Search entries")} className={cx(inputClass, "lg:max-w-sm")} />
          <Segmented
            value={status}
            onChange={setStatus}
            label={t("Status")}
            options={[
              { value: "all", label: t("All") },
              { value: "posted", label: t("Posted") },
              { value: "draft", label: t("Drafts") },
              { value: "reversed", label: t("Reversed") },
            ]}
          />
          <select value={source} onChange={(e) => setSource(e.target.value)} aria-label={t("Source")} className={cx(inputClass, "lg:w-44")}>
            <option value="">{t("Every source")}</option>
            {Object.entries(SOURCE).map(([k, v]) => (
              <option key={k} value={k}>
                {t(v)}
              </option>
            ))}
          </select>
          <p className="text-xs text-muted lg:ml-auto">{t("{n} entries", { n: rows.length })}</p>
        </div>
        {rows.length === 0 ? (
          <EmptyState icon={BookOpen} title={t("No entries match")} text={t("Try another search, status or period.")} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-[13px]">
              <thead className="border-b border-border">
                <tr>
                  <th className={cx(th, "w-16")}>{t("No")}</th>
                  <th className={cx(th, "w-28")}>{t("Date")}</th>
                  <th className={th}>{t("Description")}</th>
                  <th className={cx(th, "w-40")}>{t("Accounts")}</th>
                  <th className={cx(th, "w-32")}>{t("Source")}</th>
                  <th className={cx(th, "w-36 text-right")}>{t("Amount")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, limit).map((e) => (
                  <tr key={e.id} onClick={() => go({ v: "journal", e: e.id, q: q || undefined })} className={cx("cursor-pointer border-b border-border last:border-0 hover:bg-surface-2", route.e === e.id && "bg-accent-soft")}>
                    <td className={cx(td, "font-mono text-xs text-muted")}>{e.no ? `#${e.no}` : <Badge tone="warning">{t("Draft")}</Badge>}</td>
                    <td className={cx(td, "whitespace-nowrap text-muted")}>{fmtDate(e.date)}</td>
                    <td className={cx(td, "max-w-0")}>
                      <p className="truncate">
                        {known(e.memo)}
                        {e.ref && <span className="ml-2 font-mono text-xs text-faint">{e.ref.startsWith("BANK:") ? t("bank import") : e.ref}</span>}
                      </p>
                    </td>
                    <td className={cx(td, "font-mono text-xs text-muted")}>
                      <span className="block truncate">{[...new Set(e.lines.map((l) => l.account))].slice(0, 3).join(", ")}</span>
                    </td>
                    <td className={td}>
                      {e.reversedBy ? <Badge tone="danger">{t("Reversed")}</Badge> : e.reverses ? <Badge tone="info">{t("Reversal")}</Badge> : <span className="text-xs text-muted">{t(SOURCE[e.source])}</span>}
                    </td>
                    <td className={cx(td, num)}>{amount(sum(e.lines, "debit"))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {rows.length > limit && (
              <div className="border-t border-border p-3 text-center">
                <Button size="sm" variant="ghost" onClick={() => setLimit((l) => l + 100)}>
                  {t("Show more ({n})", { n: rows.length - limit })}
                </Button>
              </div>
            )}
          </div>
        )}
      </Card>
      <EntryDrawer entry={open} onClose={() => go({ v: "journal", q: q || undefined }, { replace: true })} />
    </>
  );
}

export function EntryDrawer({ entry, onClose }: { entry: Entry | undefined; onClose: () => void }) {
  const t = useT();
  const known = useKnown();
  const { lang } = useLang();
  const { toast } = useToast();
  const { book, today, act, edit } = useBook();
  const [reverseOn, setReverseOn] = useState<string | null>(null);
  if (!entry) return null;
  const acc = accountMap(book);
  const issues = entry.status === "draft" ? validateEntry(book, entry) : [];
  const doc = entry.doc ? book.docs.find((d) => d.id === entry.doc) : undefined;
  const reversal = entry.reversedBy ? book.entries.find((e) => e.id === entry.reversedBy) : undefined;
  const original = entry.reverses ? book.entries.find((e) => e.id === entry.reverses) : undefined;
  const firstOpen = book.lockedThrough && book.lockedThrough >= today ? addDays(book.lockedThrough, 1) : book.lockedThrough && entry.date <= book.lockedThrough ? addDays(book.lockedThrough, 1) : today;
  const defaultReverse = firstOpen < entry.date ? entry.date : firstOpen;

  return (
    <Drawer
      open
      onClose={onClose}
      title={
        <span className="flex items-center gap-2">
          {entry.no ? `#${entry.no}` : t("Draft")} · {fmtDate(entry.date)}
        </span>
      }
      footer={
        entry.status === "draft" ? (
          <>
            <Button variant="ghost" onClick={() => act((b) => deleteDraft(b, entry.id), t("Draft deleted.")) && onClose()}>
              <Trash2 /> {t("Delete")}
            </Button>
            <Button onClick={() => edit(entry)}>
              <Pencil /> {t("Edit")}
            </Button>
            <Button variant="primary" disabled={issues.length > 0} onClick={() => act((b) => postDraft(b, entry.id).book, t("Entry posted."))}>
              <Send /> {t("Post")}
            </Button>
          </>
        ) : (
          <>
            <Button variant="ghost" onClick={() => void navigator.clipboard?.writeText(shareUrl()).then(() => toast(t("Link copied.")))}>
              <Link2 /> {t("Copy link")}
            </Button>
            {!entry.reversedBy && !entry.reverses && (
              <Button onClick={() => setReverseOn(defaultReverse)}>
                <RotateCcw /> {t("Reverse")}
              </Button>
            )}
          </>
        )
      }
    >
      <h3 className="text-[15px] font-semibold">{known(entry.memo)}</h3>
      <div className="mt-2 flex flex-wrap gap-2">
        <Badge tone={entry.status === "posted" ? "success" : "warning"}>{t(entry.status === "posted" ? "Posted" : "Draft")}</Badge>
        <Badge>{t(SOURCE[entry.source])}</Badge>
        {entry.ref && !entry.ref.startsWith("BANK:") && <Badge>{entry.ref}</Badge>}
        {entry.reversedBy && <Badge tone="danger">{t("Reversed by #{n}", { n: reversal?.no ?? "?" })}</Badge>}
        {original && <Badge tone="info">{t("Reverses #{n}", { n: original.no ?? "?" })}</Badge>}
      </div>
      <div className="mt-4 overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-[13px]">
          <thead className="bg-surface-2">
            <tr>
              <th className={th}>{t("Account")}</th>
              <th className={cx(th, "text-right")}>{t("Debit")}</th>
              <th className={cx(th, "text-right")}>{t("Credit")}</th>
            </tr>
          </thead>
          <tbody>
            {entry.lines.map((l, i) => {
              const a = acc.get(l.account);
              const party = l.party ? book.parties.find((p) => p.id === l.party) : undefined;
              return (
                <tr key={i} className="border-t border-border align-top">
                  <td className="px-3 py-2">
                    <button onClick={() => go({ v: "ledger", a: l.account })} className="text-left hover:text-accent">
                      <span className="font-mono text-xs text-muted">{l.account}</span> {a ? a.name[lang] : t("Unknown account")}
                    </button>
                    {(l.memo || party || l.currency) && (
                      <p className="mt-0.5 text-xs text-muted">
                        {[party?.name, l.memo, l.currency && l.fx ? `${money(l.fx, l.currency)} @ ${fmtRate(l.rate ?? 0)}` : l.revalues ? t("{cur} revaluation", { cur: l.revalues }) : ""].filter(Boolean).join(" · ")}
                      </p>
                    )}
                  </td>
                  <td className={cx("px-3 py-2", num)}>{cell(l.debit)}</td>
                  <td className={cx("px-3 py-2", num)}>{cell(l.credit)}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot className="border-t border-border bg-surface-2 font-medium">
            <tr>
              <td className="px-3 py-2 text-xs text-muted">{t("Total")}</td>
              <td className={cx("px-3 py-2", num)}>{amount(sum(entry.lines, "debit"))}</td>
              <td className={cx("px-3 py-2", num)}>{amount(sum(entry.lines, "credit"))}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      {issues.length > 0 && (
        <ul className="mt-3 space-y-1 rounded-lg border border-danger/30 bg-danger-soft p-3 text-xs text-danger" role="alert">
          {issues.map((i, k) => (
            <li key={k}>{t(i.message, i.vars)}</li>
          ))}
        </ul>
      )}
      {doc && (
        <button onClick={() => go({ v: doc.kind === "invoice" ? "sales" : "purchases", d: doc.id })} className="mt-4 text-xs text-accent hover:underline">
          {t(doc.kind === "invoice" ? "Open invoice {n}" : "Open bill {n}", { n: doc.number })}
        </button>
      )}
      <dl className="mt-5 grid grid-cols-2 gap-3 text-xs">
        <div>
          <dt className="text-faint">{t("Created")}</dt>
          <dd className="mt-0.5 text-muted">{new Date(entry.createdAt).toLocaleString(lang === "tr" ? "tr-TR" : "en-US")}</dd>
        </div>
        {entry.postedAt && (
          <div>
            <dt className="text-faint">{t("Posted")}</dt>
            <dd className="mt-0.5 text-muted">{new Date(entry.postedAt).toLocaleString(lang === "tr" ? "tr-TR" : "en-US")}</dd>
          </div>
        )}
      </dl>
      {reverseOn !== null && (
        <div className="mt-5 rounded-lg border border-border p-3">
          <p className="font-medium">{t("Reverse this entry")}</p>
          <p className="mt-1 text-xs text-muted">{t("A new entry with the same lines and debits and credits swapped cancels this one. Both stay in the journal.")}</p>
          <div className="mt-3 flex flex-wrap items-end gap-2">
            <label className="space-y-1">
              <span className="block text-xs text-muted">{t("Reversal date")}</span>
              <input type="date" value={reverseOn} min={entry.date} onChange={(e) => setReverseOn(e.target.value)} className={cx(inputClass, "w-40")} />
            </label>
            <Button variant="ghost" onClick={() => setReverseOn(null)}>
              {t("Cancel")}
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                let id = "";
                if (act((b) => { const r = reverseEntry(b, entry.id, reverseOn); id = r.entry.id; return r.book; }, t("Entry reversed."))) {
                  setReverseOn(null);
                  go({ v: "journal", e: id }, { replace: true });
                }
              }}
            >
              {t("Post reversal")}
            </Button>
          </div>
        </div>
      )}
    </Drawer>
  );
}
