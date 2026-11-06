"use client";

import { useState } from "react";
import type { ChartId } from "@/lib/charts";
import { useT } from "@/lib/i18n";
import { emptyBook } from "@/lib/seed";
import { addBook } from "@/lib/store";
import { go } from "@/lib/route";
import { Button, Field, Modal, cx, inputClass } from "./ui";

export function NewBook({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const [name, setName] = useState("");
  const [chart, setChart] = useState<ChartId>("tdhp");
  const [error, setError] = useState<string | null>(null);
  const create = () => {
    if (!name.trim()) return setError(t("Give the company a name."));
    addBook({ ...emptyBook(chart, name.trim()), createdAt: new Date().toISOString().slice(0, 10) });
    setName("");
    setError(null);
    onClose();
    go({ v: "accounts" });
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t("New company")}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t("Cancel")}
          </Button>
          <Button variant="primary" onClick={create}>
            {t("Create books")}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label={t("Company name")} error={error ?? undefined}>
          {(id, d) => <input id={id} aria-describedby={d} value={name} onChange={(e) => setName(e.target.value)} className={inputClass} maxLength={80} autoFocus />}
        </Field>
        <fieldset>
          <legend className="mb-1.5 text-xs font-medium text-muted">{t("Chart of accounts")}</legend>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {(
              [
                ["tdhp", "Turkish uniform chart", "Tekdüzen Hesap Planı: 100 Kasa, 120 Alıcılar, 391 Hesaplanan KDV, 770 Genel yönetim giderleri."],
                ["intl", "International chart", "Assets, liabilities, equity, income and expenses, numbered 1000–8000."],
              ] as const
            ).map(([id, title, text]) => (
              <label key={id} className={cx("cursor-pointer rounded-lg border p-3 transition-colors", chart === id ? "border-accent bg-accent-soft" : "border-border hover:bg-surface-2")}>
                <input type="radio" name="chart" value={id} checked={chart === id} onChange={() => setChart(id)} className="sr-only" />
                <span className="block font-medium">{t(title)}</span>
                <span className="mt-1 block text-xs text-muted">{t(text)}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <p className="text-xs text-faint">{t("The books start empty and stay in this browser. Post an opening entry, or import one from CSV.")}</p>
      </div>
    </Modal>
  );
}
