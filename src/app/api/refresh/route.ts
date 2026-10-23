import { NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { refreshSnapshots, SUPPORTED_CLASSES, warmSimulations } from "@/lib/data/season";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Scrape NSAA, store a fresh snapshot, re-run the simulations and invalidate the static pages. Protected by
 * CRON_SECRET (Bearer token). `warm` lists the pages to request next so they regenerate before visitors arrive —
 * scripts/refresh.mjs does that.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (secret && auth !== `Bearer ${secret}` && req.nextUrl.searchParams.get("secret") !== secret) {
    return new Response("unauthorized", { status: 401 });
  }
  const { stored } = await refreshSnapshots();
  await warmSimulations();
  revalidatePath("/", "layout");
  const warm = ["/", ...SUPPORTED_CLASSES.flatMap((c) => [`/class/${c}`, `/class/${c}/simulate`])];
  return Response.json({ ok: true, stored, warm, at: new Date().toISOString() });
}
