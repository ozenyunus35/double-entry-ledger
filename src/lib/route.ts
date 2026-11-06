"use client";

import { useSyncExternalStore } from "react";

/**
 * The app is one static page; the view and what is open in it live in the query string, so every screen
 * has a link that can be shared or bookmarked: ?v=ledger&a=102.01, ?v=journal&e=<id>, ?v=sales&d=<id>.
 */

export type View = "overview" | "journal" | "ledger" | "accounts" | "sales" | "purchases" | "reports" | "currencies" | "close" | "import" | "audit";
export const VIEWS: View[] = ["overview", "journal", "ledger", "accounts", "sales", "purchases", "reports", "currencies", "close", "import", "audit"];

export interface Route {
  v: View;
  /** Open entry, account, document, report tab. */
  e?: string;
  a?: string;
  d?: string;
  r?: string;
  from?: string;
  to?: string;
  q?: string;
}

const EVENT = "folio:route";
let cached: { search: string; route: Route } | null = null;

function read(): Route {
  const search = location.search;
  if (cached && cached.search === search) return cached.route;
  const p = new URLSearchParams(search);
  const v = p.get("v") as View | null;
  const route: Route = { v: v && VIEWS.includes(v) ? v : "overview" };
  for (const k of ["e", "a", "d", "r", "from", "to", "q"] as const) {
    const x = p.get(k);
    if (x) route[k] = x;
  }
  cached = { search, route };
  return route;
}

const SERVER: Route = { v: "overview" };

function subscribe(cb: () => void) {
  window.addEventListener("popstate", cb);
  window.addEventListener(EVENT, cb);
  return () => {
    window.removeEventListener("popstate", cb);
    window.removeEventListener(EVENT, cb);
  };
}

export const useRoute = () => useSyncExternalStore(subscribe, read, () => SERVER);

/** Moves to a route. `keep` carries the period over; open things are dropped unless given again. */
export function go(next: Partial<Route>, opts: { replace?: boolean; keep?: boolean } = {}) {
  const cur = read();
  const merged: Route = { v: next.v ?? cur.v };
  if (opts.keep !== false) {
    if (cur.from) merged.from = cur.from;
    if (cur.to) merged.to = cur.to;
  }
  Object.assign(merged, next);
  const p = new URLSearchParams(location.search);
  for (const k of ["v", "e", "a", "d", "r", "from", "to", "q"]) p.delete(k);
  for (const [k, val] of Object.entries(merged)) if (val) p.set(k, String(val));
  if (merged.v === "overview") p.delete("v");
  const url = `${location.pathname}${p.toString() ? `?${p}` : ""}`;
  if (opts.replace) history.replaceState(null, "", url);
  else history.pushState(null, "", url);
  window.dispatchEvent(new Event(EVENT));
}

/** A link to the current screen that opens the same thing for someone else. */
export function shareUrl(): string {
  const p = new URLSearchParams(location.search);
  p.delete("lang");
  return `${location.origin}${location.pathname}${p.toString() ? `?${p}` : ""}`;
}
