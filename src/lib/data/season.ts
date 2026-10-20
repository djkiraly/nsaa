/**
 * Season data access: DB snapshots when DATABASE_URL is set, otherwise the
 * on-disk fixtures under data/raw. Results are cached in-process per snapshot
 * set so repeated API/agent calls are cheap.
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { and, desc, eq } from "drizzle-orm";
import { db, hasDb, schema } from "../db";
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

async function latestSnapshot(vbClass: string, kind: string) {
  if (!db) return null;
  const rows = await db
    .select()
    .from(schema.snapshots)
    .where(and(eq(schema.snapshots.season, SEASON), eq(schema.snapshots.vbClass, vbClass), eq(schema.snapshots.kind, kind)))
    .orderBy(desc(schema.snapshots.fetchedAt))
    .limit(1);
  return rows[0] ?? null;
}

export async function loadSeason(): Promise<LoadedSeason> {
  if (hasDb) {
    const exports: Partial<Record<VbClass, string>> = {};
    const regionHtml: Partial<Record<VbClass, string>> = {};
    let subdistrictHtml: string | undefined;
    let newest = 0;
    let newestId = 0;
    let dbOk = true;
    try {
      for (const c of CLASS_ORDER) {
        const s = await latestSnapshot(c, "export_csv");
        if (s) {
          exports[c] = s.body;
          if (s.fetchedAt.getTime() > newest) {
            newest = s.fetchedAt.getTime();
            newestId = s.id;
          }
        }
        if (c === "C1" || c === "C2") {
          const r = await latestSnapshot(c, "regions");
          if (r) regionHtml[c] = r.body;
        }
      }
      subdistrictHtml = (await latestSnapshot("ALL", "subdistricts"))?.body;
    } catch (e) {
      // A bad DATABASE_URL or a Neon outage shouldn't take the site down — serve the fixtures instead.
      dbOk = false;
      console.warn(`[season] snapshot DB unavailable, falling back to fixtures: ${e instanceof Error ? (e.cause ?? e.message) : e}`);
    }
    if (dbOk && Object.keys(exports).length > 0) {
      const key = `db:${newestId}`;
      if (cache?.key === key) return cache.season;
      // Assignments are fixed for the season; use the bundled copies until a refresh has stored them.
      for (const c of ["C1", "C2"] as const) regionHtml[c] ??= readFixture(`regions_${c}.html`);
      subdistrictHtml ??= readFixture("subdistricts.html");
      const season: LoadedSeason = {
        data: buildSeasonData({ seasonYear: SEASON, exports, regionHtml, subdistrictHtml }),
        snapshotKey: key,
        fetchedAt: new Date(newest),
        source: "db",
      };
      cache = { key, season, sims: new Map() };
      return season;
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
