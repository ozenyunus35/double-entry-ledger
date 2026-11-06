"use client";

import { CheckCircle2, FileInput, Landmark, Upload } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { recordPayment } from "@/lib/docs";
import { amount, date as fmtDate } from "@/lib/format";
import { useLang, useT } from "@/lib/i18n";
import { bankEntries, bankRef, decodeBytes, parseCsv, postImport, readBank, readJournal, sampleJournalCsv, type BankRow, type JournalImport } from "@/lib/importer";
import { postEntry, sortedAccounts, sum } from "@/lib/ledger";
import { useBook } from "../app";
import { Badge, Button, Card, CardHeader, EmptyState, PageHeader, Segmented, cx, inputClass, num, td, th } from "../ui";

const MAX_BYTES = 5 * 1024 * 1024;

export function Import() {
  const t = useT();
  const [mode, setMode] = useState<"journal" | "bank">("journal");
  return (
    <>
      <PageHeader title={t("Import")} description={t("CSV from Excel, another ledger or a bank. Nothing is posted until you check the preview; every entry passes the same rules as one typed by hand.")} />
      <Segmented value={mode} onChange={setMode} label={t("File type")} options={[{ value: "journal", label: t("Journal entries") }, { value: "bank", label: t("Bank statement") }]} className="mb-3" />
      {mode === "journal" ? <JournalImportView /> : <BankImportView />}
    </>
  );
}

function useFile(onText: (text: string, name: string) => void) {
  const t = useT();
  const [error, setError] = useState<string | null>(null);
  const read = async (f: File) => {
    setError(null);
    if (f.size > MAX_BYTES) return setError(t("{name} is larger than 5 MB.", { name: f.name }));
    if (/\.(xlsx|xls|pdf|docx|zip|png|jpe?g)$/i.test(f.name)) return setError(t("{name} isn't a CSV file. In Excel, use File → Save As → CSV.", { name: f.name }));
    const bytes = new Uint8Array(await f.arrayBuffer());
    if (bytes.subarray(0, 4096).some((b) => b === 0)) return setError(t("{name} looks like a binary file, not CSV text.", { name: f.name }));
    onText(decodeBytes(bytes), f.name);
  };
  return { read, error };
}

function Drop({ onFile, label }: { onFile: (f: File) => void; label: string }) {
  const t = useT();
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  return (
    <div
      onDragOver={(e) => (e.preventDefault(), setOver(true))}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const f = e.dataTransfer.files[0];
        if (f) onFile(f);
      }}
      className={cx("flex flex-col items-center justify-center rounded-lg border border-dashed px-4 py-8 text-center transition-colors", over ? "border-accent bg-accent-soft" : "border-border-strong bg-surface")}
    >
      <Upload className="size-5 text-faint" />
      <p className="mt-2 font-medium">{label}</p>
      <p className="mt-1 text-xs text-muted">{t("Comma, semicolon or tab separated; UTF-8 or Turkish Windows encoding; up to 5 MB.")}</p>
      <Button size="sm" className="mt-3" onClick={() => input.current?.click()}>
        {t("Choose a CSV file")}
      </Button>
      <input ref={input} type="file" accept=".csv,.txt,text/csv" className="hidden" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} data-testid="csv-input" />
    </div>
  );
}

function JournalImportView() {
  const t = useT();
  const { lang } = useLang();
  const { book, act } = useBook();
  const [imp, setImp] = useState<JournalImport | null>(null);
  const [name, setName] = useState("");
  const load = (text: string, n: string) => {
    setName(n);
    setImp(readJournal(book, parseCsv(text).rows));
  };
  const file = useFile(load);
  const good = imp?.entries.filter((e) => !e.issues.length) ?? [];
  const bad = imp?.entries.filter((e) => e.issues.length) ?? [];
  const acc = useMemo(() => new Map(book.accounts.map((a) => [a.code, a])), [book.accounts]);

  return (
    <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
      <div className="space-y-3">
        <Drop onFile={file.read} label={t("Drop a journal CSV")} />
        {file.error && <p className="text-xs text-danger" role="alert">{file.error}</p>}
        <Card className="p-4 text-xs text-muted">
          <p className="font-medium text-text">{t("Columns Folio reads")}</p>
          <p className="mt-1">{t("Date, Account, Debit and Credit (or one signed Amount). Optional: Entry or Fiş No to group lines, Description, Reference, Currency, FX Amount, Rate. Headers can be English or Turkish.")}</p>
          <p className="mt-2">{t("Accounts match by code (102.01, 10201) or by name. Without an entry column, lines are grouped until they balance.")}</p>
          <Button size="sm" variant="ghost" className="mt-2 -ml-2" onClick={() => load(sampleJournalCsv(book), "sample.csv")}>
            <FileInput /> {t("Try the sample file")}
          </Button>
        </Card>
      </div>
      <Card className="xl:col-span-2">
        <CardHeader title={imp ? t("Preview of {name}", { name }) : t("Preview")} meta={imp ? t("{rows} rows · {ok} entries ready · {bad} with problems", { rows: imp.rowsRead, ok: good.length, bad: bad.length }) : undefined} />
        {!imp ? (
          <EmptyState icon={FileInput} title={t("No file yet")} text={t("The preview shows every entry the file makes, and why any of them can't be posted.")} />
        ) : imp.fileIssues.length ? (
          <ul className="space-y-1 p-4 text-danger" role="alert">
            {imp.fileIssues.map((i, k) => (
              <li key={k}>{t(i.message, i.vars)}</li>
            ))}
          </ul>
        ) : (
          <>
            <div className="flex flex-wrap gap-3 border-b border-border px-4 py-2 text-xs text-muted">
              <span>{t("Decimal mark: {m}", { m: imp.decimal ?? t("not needed") })}</span>
              <span>{t("Dates: {o}", { o: imp.order === "dmy" ? t("day first") : t("month first") })}</span>
            </div>
            <div className="scroll-thin max-h-[480px] overflow-auto">
              <table className="w-full min-w-[640px] text-[13px]">
                <thead className="sticky top-0 border-b border-border bg-surface">
                  <tr>
                    <th className={th}>{t("Entry")}</th>
                    <th className={th}>{t("Date")}</th>
                    <th className={th}>{t("Lines")}</th>
                    <th className={cx(th, "text-right")}>{t("Amount")}</th>
                    <th className={th}>{t("Check")}</th>
                  </tr>
                </thead>
                <tbody>
                  {imp.entries.map((e) => (
                    <tr key={e.key + e.rows[0]} className="border-b border-border align-top">
                      <td className={cx(td, "font-mono text-xs")}>
                        {e.key}
                        <span className="block text-faint">{t("rows {r}", { r: e.rows.length > 3 ? `${e.rows[0]}–${e.rows[e.rows.length - 1]}` : e.rows.join(", ") })}</span>
                      </td>
                      <td className={cx(td, "whitespace-nowrap")}>{e.date ? fmtDate(e.date) : "—"}</td>
                      <td className={td}>
                        {e.lines.map((l, i) => (
                          <p key={i} className="text-xs">
                            <span className="font-mono text-muted">{l.account}</span> {acc.get(l.account)?.name[lang]} <span className="font-mono">{l.debit ? `Dr ${amount(l.debit)}` : `Cr ${amount(l.credit)}`}</span>
                          </p>
                        ))}
                      </td>
                      <td className={cx(td, num)}>{amount(sum(e.lines, "debit"))}</td>
                      <td className={td}>
                        {e.issues.length ? (
                          <ul className="space-y-0.5 text-xs text-danger">
                            {e.issues.slice(0, 3).map((i, k) => (
                              <li key={k}>{t(i.message, i.vars)}</li>
                            ))}
                          </ul>
                        ) : (
                          <Badge tone="success">{t("Ready")}</Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap items-center gap-2 border-t border-border p-3">
              <p className="mr-auto text-xs text-muted">{bad.length ? t("Entries with problems are left out; fix them in the file and import again.") : t("Every entry passed.")}</p>
              <Button variant="ghost" onClick={() => setImp(null)}>
                {t("Clear")}
              </Button>
              <Button
                variant="primary"
                disabled={!good.length}
                onClick={() => act((b) => postImport(b, imp).book, t("{n} entries posted.", { n: good.length })) && setImp(null)}
              >
                <CheckCircle2 /> {t("Post {n} entries", { n: good.length })}
              </Button>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}

function BankImportView() {
  const t = useT();
  const { lang } = useLang();
  const { book, act } = useBook();
  const banks = book.accounts.filter((a) => a.section === "cash" && !a.header && !a.currency);
  const [bank, setBank] = useState(banks.find((a) => a.role === "bank-try")?.code ?? banks[0]?.code ?? "");
  const [rows, setRows] = useState<BankRow[] | null>(null);
  const [issues, setIssues] = useState<string[]>([]);
  const file = useFile((text) => {
    const r = readBank(book, bank, parseCsv(text).rows);
    setRows(r.rows);
    setIssues(r.fileIssues.map((i) => t(i.message, i.vars)));
  });
  const accounts = sortedAccounts(book).filter((a) => !a.header && a.code !== bank);
  const ready = (rows ?? []).filter((r) => (r.account || r.doc) && !r.duplicate && !r.issues.length && r.date);

  const post = () =>
    act((b) => {
      let x = b;
      for (const r of ready) {
        if (r.doc) {
          const doc = x.docs.find((d) => d.id === r.doc)!;
          x = recordPayment(x, doc.id, { date: r.date!, amount: Math.abs(r.amount), rate: 1, account: bank }).book;
        }
      }
      for (const e of bankEntries(bank, ready)) x = postEntry(x, { ...e, source: "import" }).book;
      return x;
    }, t("{n} bank lines posted.", { n: ready.length })) && setRows(null);

  return (
    <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
      <div className="space-y-3">
        <Card className="p-4">
          <label className="text-xs font-medium text-muted" htmlFor="bank-acc">
            {t("Bank account in the file")}
          </label>
          <select id="bank-acc" value={bank} onChange={(e) => setBank(e.target.value)} className={cx(inputClass, "mt-1.5")}>
            {banks.map((a) => (
              <option key={a.code} value={a.code}>
                {a.code} · {a.name[lang]}
              </option>
            ))}
          </select>
        </Card>
        <Drop onFile={file.read} label={t("Drop a bank statement CSV")} />
        {file.error && <p className="text-xs text-danger" role="alert">{file.error}</p>}
        <Card className="p-4 text-xs text-muted">
          <p className="font-medium text-text">{t("What happens")}</p>
          <p className="mt-1">{t("Each line gets a suggested other side: an open invoice or bill it pays exactly, or an account from words like kira, maaş, SGK, faiz or komisyon. Lines already imported are skipped.")}</p>
        </Card>
      </div>
      <Card className="xl:col-span-2">
        <CardHeader title={t("Bank lines")} meta={rows ? t("{n} ready to post", { n: ready.length }) : undefined} icon={Landmark} />
        {issues.length > 0 && (
          <ul className="space-y-1 p-4 text-danger" role="alert">
            {issues.map((i) => (
              <li key={i}>{i}</li>
            ))}
          </ul>
        )}
        {!rows ? (
          <EmptyState icon={Landmark} title={t("No file yet")} text={t("Export the statement from online banking as CSV and drop it here.")} />
        ) : (
          <>
            <div className="scroll-thin max-h-[480px] overflow-auto">
              <table className="w-full min-w-[680px] text-[13px]">
                <thead className="sticky top-0 border-b border-border bg-surface">
                  <tr>
                    <th className={th}>{t("Date")}</th>
                    <th className={th}>{t("Description")}</th>
                    <th className={cx(th, "text-right")}>{t("Amount")}</th>
                    <th className={th}>{t("Other side")}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => {
                    const doc = r.doc ? book.docs.find((d) => d.id === r.doc) : undefined;
                    return (
                      <tr key={i} className={cx("border-b border-border", r.duplicate && "opacity-50")}>
                        <td className={cx(td, "whitespace-nowrap")}>{r.date ? fmtDate(r.date) : <span className="text-danger">—</span>}</td>
                        <td className={cx(td, "max-w-0")}>
                          <p className="truncate">{r.description}</p>
                          {r.issues.map((x, k) => (
                            <p key={k} className="text-xs text-danger">
                              {t(x.message, x.vars)}
                            </p>
                          ))}
                        </td>
                        <td className={cx(td, num, r.amount > 0 ? "text-success" : "")}>{Number.isFinite(r.amount) ? amount(r.amount) : "—"}</td>
                        <td className={td}>
                          {r.duplicate ? (
                            <Badge>{t("Already imported")}</Badge>
                          ) : doc ? (
                            <Badge tone="success">{t(doc.kind === "invoice" ? "Pays invoice {n}" : "Pays bill {n}", { n: doc.number })}</Badge>
                          ) : (
                            <select
                              value={r.account ?? ""}
                              onChange={(e) => setRows((rs) => rs!.map((x, k) => (k === i ? { ...x, account: e.target.value || null } : x)))}
                              aria-label={t("Other side for row {n}", { n: r.row })}
                              className={cx(inputClass, "h-7 text-xs", !r.account && "text-muted")}
                            >
                              <option value="">{t("Choose an account")}</option>
                              {accounts.map((a) => (
                                <option key={a.code} value={a.code}>
                                  {a.code} · {a.name[lang]}
                                </option>
                              ))}
                            </select>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap items-center gap-2 border-t border-border p-3">
              <p className="mr-auto text-xs text-muted">{t("Lines without an account stay out. Ref {ref} marks them so a second import skips them.", { ref: bankRef(bank, { date: "…", amount: 0, description: "" }).split(":")[0] })}</p>
              <Button variant="primary" disabled={!ready.length} onClick={post}>
                <CheckCircle2 /> {t("Post {n} lines", { n: ready.length })}
              </Button>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
