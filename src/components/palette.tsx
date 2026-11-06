"use client";

import { CornerDownLeft, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/cn";

export interface Command {
  id: string;
  label: string;
  group: string;
  icon?: React.ComponentType<{ className?: string }>;
  hint?: string;
  /** Extra words that should find this command, such as a document's file name. */
  keywords?: string;
  run: () => void;
}

/** Case and accent insensitive, so "fatura" finds "Fatura" and "ozet" finds "Özet". */
const fold = (s: string) => s.toLocaleLowerCase("tr").normalize("NFD").replace(/\p{M}/gu, "").replace(/ı/g, "i");

/** Opens on ⌘K / Ctrl+K anywhere, except while typing in a field where Ctrl+K means something else. */
export function usePaletteShortcut(open: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        open();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
}

/** ⌘K: jump to any document or view, or run an action, from the keyboard. */
export function Palette({ open, onClose, commands }: { open: boolean; onClose: () => void; commands: Command[] }) {
  const t = useT();
  const [q, setQ] = useState("");
  const [i, setI] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (open && !d.open) {
      d.showModal();
      requestAnimationFrame(() => input.current?.focus());
    }
    if (!open && d.open) d.close();
  }, [open]);

  const list = useMemo(() => {
    const words = fold(q.trim()).split(/\s+/).filter(Boolean);
    if (!words.length) return commands;
    return commands.filter((c) => {
      const hay = fold(`${c.label} ${c.group} ${c.hint ?? ""} ${c.keywords ?? ""}`);
      return words.every((w) => hay.includes(w));
    });
  }, [q, commands]);

  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [i]);

  const close = () => {
    setQ("");
    setI(0);
    onClose();
  };
  const pick = (c: Command | undefined) => {
    if (!c) return;
    close();
    c.run();
  };

  return (
    <dialog
      ref={dialog}
      onClose={close}
      onClick={(e) => e.target === dialog.current && close()}
      aria-label={t("Command palette")}
      className="mx-auto mt-[12vh] w-[calc(100%-2rem)] max-w-xl rounded-xl border-0 bg-surface p-0 text-text shadow-pop"
    >
      {open && (
        <div>
          <div className="flex items-center gap-2 border-b border-border px-3">
            <Search className="size-4 text-faint" aria-hidden />
            <input
              ref={input}
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setI(0);
              }}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setI((x) => Math.min(list.length - 1, x + 1));
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setI((x) => Math.max(0, x - 1));
                } else if (e.key === "Enter") {
                  e.preventDefault();
                  pick(list[i]);
                }
              }}
              placeholder={t("Search documents, views and actions…")}
              className="h-12 min-w-0 flex-1 bg-transparent text-[14px] outline-none placeholder:text-faint"
              aria-label={t("Search commands")}
              role="combobox"
              aria-expanded="true"
              aria-controls="palette-list"
            />
            <kbd className="rounded border border-border px-1.5 text-[10.5px] text-faint">esc</kbd>
          </div>
          <ul ref={listRef} id="palette-list" className="max-h-[52vh] overflow-y-auto p-1.5" role="listbox">
            {list.map((c, k) => {
              const header = k === 0 || list[k - 1].group !== c.group ? c.group : null;
              return (
                <li key={c.id} role="option" aria-selected={k === i}>
                  {header && <p className="px-2.5 pt-2 pb-1 text-[10.5px] font-medium tracking-wide text-faint uppercase">{header}</p>}
                  <button
                    onMouseMove={() => setI(k)}
                    onClick={() => pick(c)}
                    className={cn("flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left", k === i ? "bg-accent-soft text-text" : "text-text")}
                  >
                    {c.icon && <c.icon className="size-3.5 shrink-0 text-muted" />}
                    <span className="min-w-0 flex-1 truncate">{c.label}</span>
                    {c.hint && <span className="max-w-[40%] truncate text-[11px] text-faint">{c.hint}</span>}
                    {k === i && <CornerDownLeft className="size-3.5 shrink-0 text-faint" aria-hidden />}
                  </button>
                </li>
              );
            })}
            {!list.length && <li className="px-3 py-6 text-center text-muted">{t("No results")}</li>}
          </ul>
          <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-border px-3 py-2 text-[11px] text-faint">
            <span>
              <kbd className="font-sans">↑↓</kbd> {t("move")}
            </span>
            <span>
              <kbd className="font-sans">↵</kbd> {t("open")}
            </span>
            <span>
              <kbd className="font-sans">j / k</kbd> {t("next or previous document, outside the palette")}
            </span>
          </div>
        </div>
      )}
    </dialog>
  );
}
