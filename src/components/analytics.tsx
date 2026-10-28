"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

/**
 * First-party, cookie-free usage tracking → /api/e. A random visitor id lives in localStorage; a visit (session)
 * ends after 30 idle minutes. While the page is visible a heartbeat every 30 s keeps the visit's end time current,
 * which is how visit length is measured. Browsers that send Global Privacy Control or Do Not Track are skipped.
 */
const IDLE_MS = 30 * 60_000;
const HEARTBEAT_MS = 30_000;

type Session = { id: string; last: number };
let memory: { v?: string; s?: Session } = {}; // fallback when localStorage is blocked

const optedOut = () =>
  (navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl === true || navigator.doNotTrack === "1";

const newId = () => crypto.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

/** Visitor and visit ids; `fresh` when this call started a new visit. */
function ids(): { v: string; s: string; fresh: boolean } {
  const now = Date.now();
  let v = memory.v;
  let s = memory.s;
  try {
    v = localStorage.getItem("nsaa_v") ?? v;
    s = JSON.parse(localStorage.getItem("nsaa_s") ?? "null") ?? s;
  } catch {}
  v ??= newId();
  const fresh = !s || now - s.last > IDLE_MS;
  s = fresh ? { id: newId(), last: now } : { id: s!.id, last: now };
  memory = { v, s };
  try {
    localStorage.setItem("nsaa_v", v);
    localStorage.setItem("nsaa_s", JSON.stringify(s));
  } catch {}
  return { v, s: s.id, fresh };
}

/** The current visitor and visit ids, for tying a chat transcript to its visit — none when the browser is opted out. */
export function analyticsIds(): { visitorId: string; sessionId: string } | undefined {
  if (optedOut()) return undefined;
  const { v, s } = ids();
  return { visitorId: v, sessionId: s };
}

export function track(type: "pageview" | "ping" | "chat") {
  if (optedOut() || location.pathname.startsWith("/analytics")) return;
  const { v, s, fresh } = ids();
  // A heartbeat after 30 idle minutes is someone coming back: count it as a new visit's first view.
  const t = type === "ping" && fresh ? "pageview" : type;
  const body = JSON.stringify({
    v,
    s,
    t,
    p: location.pathname,
    r: fresh && document.referrer ? document.referrer : undefined,
  });
  if (navigator.sendBeacon?.("/api/e", new Blob([body], { type: "application/json" }))) return;
  fetch("/api/e", { method: "POST", body, keepalive: true, headers: { "content-type": "application/json" } }).catch(
    () => {},
  );
}

export function AnalyticsTracker() {
  const pathname = usePathname();
  useEffect(() => track("pageview"), [pathname]);
  useEffect(() => {
    const beat = setInterval(() => document.visibilityState === "visible" && track("ping"), HEARTBEAT_MS);
    const hidden = () => document.visibilityState === "hidden" && track("ping"); // tab switched or closed
    document.addEventListener("visibilitychange", hidden);
    return () => {
      clearInterval(beat);
      document.removeEventListener("visibilitychange", hidden);
    };
  }, []);
  return null;
}
