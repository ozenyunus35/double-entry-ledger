"use client";

import { Moon, Sun } from "lucide-react";
import { useSyncExternalStore } from "react";
import { useT } from "@/lib/i18n";

function subscribe(cb: () => void) {
  const obs = new MutationObserver(cb);
  obs.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  return () => obs.disconnect();
}

export function toggleTheme() {
  const next = !document.documentElement.classList.contains("dark");
  document.documentElement.classList.toggle("dark", next);
  try {
    localStorage.setItem("folio:theme", next ? "dark" : "light");
  } catch {}
}

export const useDark = () => useSyncExternalStore(subscribe, () => document.documentElement.classList.contains("dark"), () => false);

export function ThemeToggle() {
  const t = useT();
  const dark = useDark();
  return (
    <button onClick={toggleTheme} data-theme-toggle className="rounded-md p-1.5 text-muted hover:bg-surface-2 hover:text-text" aria-label={t(dark ? "Switch to light theme" : "Switch to dark theme")}>
      {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </button>
  );
}
