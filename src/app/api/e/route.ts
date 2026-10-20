import { NextRequest } from "next/server";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/lib/db";
import { locate } from "@/lib/analytics/geo";
import { isBot, parseUserAgent } from "@/lib/analytics/ua";

export const runtime = "nodejs";

/**
 * Analytics collector (sent by components/analytics.tsx; named /api/e so blockers that drop "/track" don't).
 *   pageview → upsert the visit (location + device on first sight) and log the view
 *   chat     → same, logging a chat question (its text is not stored)
 *   ping     → heartbeat: extends the visit's last_seen_at, which is how visit length is measured
 * Always answers 204 — analytics must never break a page.
 */
const Body = z.object({
  v: z.string().regex(/^[\w-]{8,64}$/),
  s: z.string().regex(/^[\w-]{8,64}$/),
  t: z.enum(["pageview", "ping", "chat"]),
  p: z.string().startsWith("/").max(300),
  r: z.string().max(1000).optional(),
});

const ok = () => new Response(null, { status: 204 });

export async function POST(req: NextRequest) {
  const ua = req.headers.get("user-agent");
  if (!db || isBot(ua)) return ok();
  let e: z.infer<typeof Body>;
  try {
    e = Body.parse(JSON.parse(await req.text()));
  } catch {
    return new Response(null, { status: 400 });
  }
  if (e.p.startsWith("/analytics")) return ok();

  const s = schema.analyticsSessions;
  try {
    if (e.t === "ping") {
      await db.update(s).set({ lastSeenAt: sql`now()` }).where(eq(s.id, e.s));
      return ok();
    }
    const views = e.t === "pageview" ? 1 : 0;
    await db
      .insert(s)
      .values({
        id: e.s,
        visitorId: e.v,
        pageviews: views,
        entryPath: e.p,
        referrer: referrerHost(e.r, req),
        // nginx passes the visitor's address as X-Real-IP; only the place it resolves to is kept
        ...(await locate(req.headers.get("x-real-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0].trim())),
        ...parseUserAgent(ua!),
      })
      .onConflictDoUpdate({ target: s.id, set: { lastSeenAt: sql`now()`, pageviews: sql`${s.pageviews} + ${views}` } });
    await db.insert(schema.analyticsEvents).values({ sessionId: e.s, visitorId: e.v, type: e.t, path: e.p });
  } catch (err) {
    console.warn(`[analytics] ${err instanceof Error ? err.message : err}`);
  }
  return ok();
}

/** The referring site's host, or null when it's this site (or missing). */
function referrerHost(ref: string | undefined, req: NextRequest): string | null {
  if (!ref) return null;
  try {
    const host = new URL(ref).hostname.replace(/^www\./, "");
    const self = (req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "").split(":")[0].replace(/^www\./, "");
    return host && host !== self ? host : null;
  } catch {
    return null;
  }
}
