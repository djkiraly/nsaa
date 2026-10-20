/**
 * Season data access: DB snapshots when DATABASE_URL is set, otherwise the
 * on-disk fixtures under data/raw. Results are cached in-process per snapshot
 * set so repeated API/agent calls are cheap.
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db, schema } from "../db";
import { CLASS_ORDER, type VbClass } from "../engine/types";
import { buildSeasonData } from "./load";
import { NSAA_URLS } from "./load";
import { project, runSimulation, type SeasonData, type SimResult } from "../engine/simulate";

export const SEASON = Number(process.env.NSAA_SEASON ?? 2026);
export const SEEDING_CUTOFF = process.env.NSAA_SEEDING_CUTOFF ?? `${SEASON}-10-20`;
export const SUPPORTED_CLASSES: VbClass[] = CLASS_ORDER;

const RAW_DIR = join(process.cwd(), "data", "raw");
const readFixture = (file: string) => {
  const p = join(RAW_DIR, file);
  return existsSync(p) ? readFileSync(p, "utf8") : undefined;
};

export interface LoadedSeason {
  data: SeasonData;
  /** identifier of the snapshot set (DB id or "fixtures") */
  snapshotKey: string;
  fetchedAt: Date;
  source: "db" | "fixtures";
}

let cache: { key: string; season: LoadedSeason; sims: Map<string, SimResult> } | null = null;

type Db = NonNullable<typeof db>;

/**
 * Newest snapshot of every kind the engine reads — ids and times only, no bodies. One cheap query that tells
 * loadSeason whether anything changed, so cache hits don't pull ~700 KB of stored pages.
 */
export async function latestSnapshotIds(d: Db) {
  const s = schema.snapshots;
  return d
    .selectDistinctOn([s.vbClass, s.kind], { id: s.id, vbClass: s.vbClass, kind: s.kind, fetchedAt: s.fetchedAt })
    .from(s)
    .where(and(eq(s.season, SEASON), inArray(s.kind, ["export_csv", "regions", "subdistricts"])))
    .orderBy(s.vbClass, s.kind, desc(s.fetchedAt));
}

export async function loadFromDb(d: Db): Promise<LoadedSeason | null> {
  const latest = await latestSnapshotIds(d);
  const exportsLatest = latest.filter((r) => r.kind === "export_csv");
  if (exportsLatest.length === 0) return null;
  const key = `db:${Math.max(...latest.map((r) => r.id))}`;
  if (cache?.key === key) return cache.season;

  const s = schema.snapshots;
  const rows = await d
    .select({ vbClass: s.vbClass, kind: s.kind, body: s.body })
    .from(s)
    .where(inArray(s.id, latest.map((r) => r.id)));
  const body = (vbClass: string, kind: string) => rows.find((r) => r.vbClass === vbClass && r.kind === kind)?.body;
  const exports: Partial<Record<VbClass, string>> = {};
  const regionHtml: Partial<Record<VbClass, string>> = {};
  for (const c of CLASS_ORDER) exports[c] = body(c, "export_csv");
  // Assignments are fixed for the season; use the bundled copies until a refresh has stored them.
  for (const c of ["C1", "C2"] as const) regionHtml[c] = body(c, "regions") ?? readFixture(`regions_${c}.html`);
  const subdistrictHtml = body("ALL", "subdistricts") ?? readFixture("subdistricts.html");

  const season: LoadedSeason = {
    data: buildSeasonData({ seasonYear: SEASON, exports, regionHtml, subdistrictHtml }),
    snapshotKey: key,
    fetchedAt: new Date(Math.max(...exportsLatest.map((r) => r.fetchedAt.getTime()))),
    source: "db",
  };
  cache = { key, season, sims: new Map() };
  return season;
}

export async function loadSeason(): Promise<LoadedSeason> {
  if (db) {
    try {
      const season = await loadFromDb(db);
      if (season) return season;
    } catch (e) {
      // A bad DATABASE_URL or a database outage shouldn't take the site down — serve the fixtures instead.
      console.warn(`[season] snapshot DB unavailable, falling back to fixtures: ${e instanceof Error ? (e.cause ?? e.message) : e}`);
    }
  }
  // Fixtures fallback
  const key = "fixtures";
  if (cache?.key === key) return cache.season;
  const exports: Partial<Record<VbClass, string>> = {};
  const regionHtml: Partial<Record<VbClass, string>> = {};
  for (const c of CLASS_ORDER) {
    exports[c] = readFixture(`vb_${c}.csv`);
    regionHtml[c] = readFixture(`regions_${c}.html`);
  }
  if (!Object.values(exports).some(Boolean)) throw new Error("No season data: run `npm run scrape` or set DATABASE_URL");
  const season: LoadedSeason = {
    data: buildSeasonData({ seasonYear: SEASON, exports, regionHtml, subdistrictHtml: readFixture("subdistricts.html") }),
    snapshotKey: key,
    fetchedAt: new Date(),
    source: "fixtures",
  };
  cache = { key, season, sims: new Map() };
  return season;
}

export async function getProjection(vbClass: VbClass) {
  const s = await loadSeason();
  return { ...project(s.data, vbClass, SEEDING_CUTOFF), snapshotKey: s.snapshotKey, fetchedAt: s.fetchedAt };
}

export async function getSimulation(vbClass: VbClass, nSims = 2000): Promise<SimResult> {
  const s = await loadSeason();
  const k = `${vbClass}:${nSims}`;
  const hit = cache?.sims.get(k);
  if (hit) return hit;
  const res = runSimulation(s.data, { vbClass, cutoff: SEEDING_CUTOFF, nSims, seed: 20261020 });
  cache?.sims.set(k, res);
  return res;
}

/** Run every class's simulation (~1 s each) so the first page view after a refresh doesn't pay for it. */
export async function warmSimulations() {
  for (const c of SUPPORTED_CLASSES) await getSimulation(c);
}

/** Scrape NSAA and store a fresh snapshot set. Returns what was stored. */
export async function refreshSnapshots(classes: VbClass[] = CLASS_ORDER) {
  const stored: { vbClass: string; kind: string; bytes: number }[] = [];
  const put = async (vbClass: string, kind: string, url: string, ref?: string) => {
    const res = await fetch(url, { cache: "no-store", headers: { "user-agent": "nsaa-volleyball-agent/0.1" } });
    if (!res.ok) throw new Error(`${url} → ${res.status}`);
    const body = await res.text();
    if (db) await db.insert(schema.snapshots).values({ season: SEASON, vbClass, kind, ref, url, body });
    stored.push({ vbClass, kind, bytes: body.length });
    return body;
  };
  const bodies: Record<string, string> = {};
  for (const c of classes) {
    bodies[`export_${c}`] = await put(c, "export_csv", NSAA_URLS.exportCsv(c));
    bodies[`leaders_${c}`] = await put(c, "leaders", NSAA_URLS.leaders(c, SEASON));
    if (c === "C1" || c === "C2") {
      bodies[`regions_${c}`] = await put(c, "regions", NSAA_URLS.regions(c));
      bodies[`standings_${c}`] = await put(c, "region_standings", NSAA_URLS.regionStandings(c));
    }
  }
  bodies.subdistricts = await put("ALL", "subdistricts", NSAA_URLS.subdistricts);
  await put("ALL", "district_finals", NSAA_URLS.districtFinals);
  cache = null; // force rebuild
  return { stored, bodies };
}
