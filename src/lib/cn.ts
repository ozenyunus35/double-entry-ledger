/** Joins class names, skipping empty ones. */
export const cn = (...xs: (string | false | null | undefined)[]) => xs.filter(Boolean).join(" ");
