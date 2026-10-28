/** Bits every /analytics page needs: the cookie check and Central-time formatting. */
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { ANALYTICS_COOKIE, isAnalyticsCookie } from "./auth";
import { TZ } from "./queries";

/** proxy.ts already turns away anyone without the cookie; checking again means a page can't render without it. */
export async function requireAnalyticsCookie() {
  if (!isAnalyticsCookie((await cookies()).get(ANALYTICS_COOKIE)?.value)) notFound();
}

export const fmtTime = (d: Date) =>
  d.toLocaleString("en-US", { timeZone: TZ, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export const fmtTimeSec = (d: Date) =>
  d.toLocaleString("en-US", { timeZone: TZ, month: "short", day: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit" });

export function duration(s: number): string {
  const sec = Math.round(s);
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ${String(sec % 60).padStart(2, "0")}s`;
  return `${Math.floor(sec / 3600)}h ${String(Math.floor((sec % 3600) / 60)).padStart(2, "0")}m`;
}

export const num = (x: number) => x.toLocaleString("en-US");

/** A short id for display: enough to tell visits apart. */
export const shortId = (id: string) => id.slice(0, 8);
