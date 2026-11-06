import { cx } from "./ui";

/** Folio's mark: an open ledger, two facing pages with a ruled column each. */
export function FolioMark({ size = 22, className }: { size?: number; className?: string }) {
  return (
    <span className={cx("grid shrink-0 place-items-center rounded-md bg-text text-bg", className)} style={{ width: size, height: size }} aria-hidden>
      <svg viewBox="0 0 24 24" style={{ width: size * 0.68, height: size * 0.68 }} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 6.5c-2-1.6-4.6-2-7.5-1.5v13c2.9-.5 5.5-.1 7.5 1.5 2-1.6 4.6-2 7.5-1.5V5c-2.9-.5-5.5-.1-7.5 1.5z" />
        <path d="M12 6.5v13" />
        <path d="M7.5 10h2M7.5 13.5h2M14.5 10h2M14.5 13.5h2" />
      </svg>
    </span>
  );
}
