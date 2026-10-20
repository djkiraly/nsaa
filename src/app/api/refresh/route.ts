import { NextRequest } from "next/server";
import { refreshSnapshots } from "@/lib/data/season";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Scrape NSAA and store a fresh snapshot. Protect with CRON_SECRET (Vercel cron sends it as a Bearer token). */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (secret && auth !== `Bearer ${secret}` && req.nextUrl.searchParams.get("secret") !== secret) {
    return new Response("unauthorized", { status: 401 });
  }
  const { stored } = await refreshSnapshots();
  return Response.json({ ok: true, stored, at: new Date().toISOString() });
}
