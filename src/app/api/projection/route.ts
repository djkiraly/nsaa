import { NextRequest } from "next/server";
import { getProjection, SUPPORTED_CLASSES } from "@/lib/data/season";
import type { VbClass } from "@/lib/engine/types";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const cls = (req.nextUrl.searchParams.get("class") ?? "B").toUpperCase() as VbClass;
  if (!SUPPORTED_CLASSES.includes(cls)) return Response.json({ error: `class must be one of ${SUPPORTED_CLASSES}` }, { status: 400 });
  return Response.json(await getProjection(cls));
}
