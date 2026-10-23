import { NextRequest } from "next/server";
import { getSimulation, summarizeSimulation, SUPPORTED_CLASSES, validPicks } from "@/lib/data/season";
import type { VbClass } from "@/lib/engine/types";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const cls = (req.nextUrl.searchParams.get("class") ?? "B").toUpperCase() as VbClass;
  if (!SUPPORTED_CLASSES.includes(cls)) return Response.json({ error: `class must be one of ${SUPPORTED_CLASSES}` }, { status: 400 });
  const n = Math.min(10000, Number(req.nextUrl.searchParams.get("n") ?? 2000));
  const res = await getSimulation(cls, n);
  return Response.json(res);
}

/** Simulation run counts the what-if page offers; anything else is refused (each run blocks the server ~1–3 s). */
const SCENARIO_SIZES = [2000, 5000];

/**
 * What-if run: `{ class, n, picks: { matchId: winner } }` → per-team odds and per-match winners (SimSummary).
 * Picks that don't name one of the class's matches and teams are dropped; the response says which were used.
 */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { class?: string; n?: number; picks?: unknown } | null;
  const cls = String(body?.class ?? "").toUpperCase() as VbClass;
  if (!SUPPORTED_CLASSES.includes(cls)) return Response.json({ error: `class must be one of ${SUPPORTED_CLASSES}` }, { status: 400 });
  const n = SCENARIO_SIZES.includes(Number(body?.n)) ? Number(body!.n) : SCENARIO_SIZES[0];
  const picks = await validPicks(cls, body?.picks);
  return Response.json(summarizeSimulation(await getSimulation(cls, n, picks)));
}
