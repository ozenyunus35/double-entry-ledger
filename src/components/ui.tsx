"use client";

import { Loader2, X } from "lucide-react";
import { forwardRef, useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { useT } from "@/lib/i18n";

export const cx = (...c: Array<string | false | null | undefined>) => c.filter(Boolean).join(" ");

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md";
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({ variant = "secondary", size = "md", className, ...props }, ref) {
  return (
    <button
      ref={ref}
      className={cx(
        "inline-flex items-center justify-center gap-1.5 rounded-md text-[13px] font-medium whitespace-nowrap transition-[background-color,color,transform] duration-100 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-3.5",
        size === "sm" ? "h-7 px-2.5" : "h-8 px-3",
        variant === "primary" && "bg-accent text-accent-fg hover:bg-accent/90",
        variant === "secondary" && "border border-border bg-surface text-text shadow-card hover:bg-surface-2",
        variant === "ghost" && "text-muted hover:bg-surface-2 hover:text-text",
        variant === "danger" && "bg-danger text-white hover:bg-danger/90",
        className,
      )}
      {...props}
    />
  );
});

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cx("rounded-lg border border-border bg-surface shadow-card", className)} {...props} />;
}

export function CardHeader({ title, meta, icon: Icon }: { title: string; meta?: React.ReactNode; icon?: React.ComponentType<{ className?: string }> }) {
  return (
    <div className="flex min-h-11 items-center justify-between gap-3 border-b border-border px-4 py-2">
      <h2 className="flex min-w-0 items-center gap-2 text-[13px] font-medium">
        {Icon && <Icon className="size-3.5 shrink-0 text-muted" aria-hidden />}
        <span className="truncate">{title}</span>
      </h2>
      {meta && <div className="min-w-0 text-right text-xs text-muted">{meta}</div>}
    </div>
  );
}

const TONES = {
  neutral: "bg-faint",
  accent: "bg-accent",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
  info: "bg-info",
} as const;
export type Tone = keyof typeof TONES;

export function Badge({ tone = "neutral", children, className }: { tone?: Tone; children: React.ReactNode; className?: string }) {
  return (
    <span className={cx("inline-flex h-5 items-center gap-1.5 rounded-md border border-border px-1.5 text-xs whitespace-nowrap text-muted", className)}>
      <span className={cx("size-1.5 rounded-full", TONES[tone])} aria-hidden />
      {children}
    </span>
  );
}

export function Field({ label, error, hint, children, className }: { label: string; error?: string; hint?: string; className?: string; children: (id: string, describedBy?: string) => React.ReactNode }) {
  const id = useId();
  const msgId = error || hint ? `${id}-msg` : undefined;
  return (
    <div className={cx("space-y-1.5", className)}>
      <label htmlFor={id} className="block text-xs font-medium text-muted">
        {label}
      </label>
      {children(id, msgId)}
      {(error || hint) && (
        <p id={msgId} className={cx("text-xs", error ? "text-danger" : "text-faint")}>
          {error ?? hint}
        </p>
      )}
    </div>
  );
}

export const inputClass =
  "h-8 w-full min-w-0 rounded-md border border-border bg-surface px-2.5 text-[13px] shadow-card transition-colors placeholder:text-faint hover:border-border-strong focus:border-accent focus:outline-none aria-[invalid=true]:border-danger";

export function Modal({ open, onClose, title, children, footer, size = "md" }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode; footer?: React.ReactNode; size?: "md" | "lg" | "xl" }) {
  const t = useT();
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      className={cx("m-auto w-[calc(100%-1.5rem)] rounded-xl border-0 bg-surface p-0 text-text shadow-pop", size === "xl" ? "max-w-5xl" : size === "lg" ? "max-w-3xl" : "max-w-md")}
    >
      {open && (
        <div className="flex max-h-[88vh] flex-col">
          <div className="flex h-12 shrink-0 items-center justify-between gap-4 border-b border-border px-4">
            <h2 id={titleId} className="truncate text-[13px] font-semibold">
              {title}
            </h2>
            <button onClick={onClose} className="rounded-md p-1 text-muted hover:bg-surface-2 hover:text-text" aria-label={t("Close dialog")}>
              <X className="size-4" />
            </button>
          </div>
          <div className="scroll-thin overflow-y-auto p-4">{children}</div>
          {footer && <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-border px-4 py-3">{footer}</div>}
        </div>
      )}
    </dialog>
  );
}

/** A side panel for one record: an entry, a document. Closes on Escape and on the backdrop. */
export function Drawer({ open, onClose, title, children, footer }: { open: boolean; onClose: () => void; title: React.ReactNode; children: React.ReactNode; footer?: React.ReactNode }) {
  const t = useT();
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !document.querySelector("dialog[open]") && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open || typeof document === "undefined") return null;
  // A portal, because a transformed ancestor (the page's entrance animation) would trap position: fixed.
  return createPortal(
    <div className="fixed inset-0 z-40" role="presentation">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-[1px]" onClick={onClose} />
      <aside role="dialog" aria-modal="true" aria-label={typeof title === "string" ? title : undefined} className="animate-panel absolute inset-y-0 right-0 flex w-full max-w-xl flex-col border-l border-border bg-surface shadow-pop">
        <div className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-border px-4">
          <div className="min-w-0 truncate text-[13px] font-semibold">{title}</div>
          <button onClick={onClose} className="rounded-md p-1 text-muted hover:bg-surface-2 hover:text-text" aria-label={t("Close panel")}>
            <X className="size-4" />
          </button>
        </div>
        <div className="scroll-thin min-h-0 flex-1 overflow-y-auto p-4">{children}</div>
        {footer && <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-border px-4 py-3">{footer}</div>}
      </aside>
    </div>,
    document.body,
  );
}

export function EmptyState({ icon: Icon, title, text, action }: { icon: React.ComponentType<{ className?: string }>; title: string; text?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      <Icon className="mb-3 size-6 text-faint" />
      <p className="font-medium">{title}</p>
      {text && <p className="mt-1 max-w-sm text-muted">{text}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="mb-5 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-[-0.01em]">{title}</h1>
        {description && <p className="mt-1 text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Spinner({ label = "Loading" }: { label?: string }) {
  return (
    <div className="flex items-center justify-center py-20 text-muted" role="status">
      <Loader2 className="size-5 animate-spin" aria-hidden />
      <span className="sr-only">{label}</span>
    </div>
  );
}

/** Segmented control for a few options. */
export function Segmented<T extends string>({ value, onChange, options, label, className }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; label: string; className?: string }) {
  return (
    <div role="tablist" aria-label={label} className={cx("inline-flex max-w-full overflow-x-auto rounded-md border border-border bg-surface p-0.5 shadow-card", className)}>
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          aria-selected={value === o.value}
          onClick={() => onChange(o.value)}
          className={cx("h-6 shrink-0 rounded px-2.5 text-xs font-medium whitespace-nowrap transition-colors", value === o.value ? "bg-surface-3 text-text" : "text-muted hover:text-text")}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export const th = "h-9 px-3 text-left text-xs font-medium whitespace-nowrap text-muted";
export const td = "h-10 px-3 align-middle";
export const num = "text-right font-mono text-[12.5px] tabular-nums whitespace-nowrap";

/** Thin trend line for metric tiles. */
export function Sparkline({ data, className, color = "var(--accent)" }: { data: number[]; className?: string; color?: string }) {
  if (data.length < 2) return null;
  const w = 120;
  const h = 28;
  const max = Math.max(...data);
  const min = Math.min(...data);
  const span = max - min || 1;
  const line = data.map((v, i) => `${i ? "L" : "M"}${((i / (data.length - 1)) * w).toFixed(1)},${(h - 2 - ((v - min) / span) * (h - 4)).toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className={cx("h-7 overflow-visible", className ?? "w-full")} aria-hidden>
      <path d={line} fill="none" stroke={color} strokeWidth="1.25" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/** A check the books passed or failed, shown as a quiet line. */
export function Check({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <p className="flex items-start gap-2 text-xs">
      <span className={cx("mt-1 size-1.5 shrink-0 rounded-full", ok ? "bg-success" : "bg-danger")} aria-hidden />
      <span className={ok ? "text-muted" : "text-danger"}>{children}</span>
    </p>
  );
}
