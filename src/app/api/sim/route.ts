import { NextRequest } from "next/server";
import { getSimulation, SUPPORTED_CLASSES } from "@/lib/data/season";
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
