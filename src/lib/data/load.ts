/**
 * Assemble a SeasonData object from raw NSAA files (on disk or fetched).
 */
import { CLASS_ORDER, type Match, type VbClass } from "../engine/types";
import { buildGeo } from "../engine/geo";
import { canonicalize, fitRatings } from "../engine/ratings";
import type { SeasonData } from "../engine/simulate";
import { parseNsaaExport } from "./parse-nsaa";
import { matchTeamName, parseRegionAssignments, parseSubdistrictAssignments } from "./parse-html";
import type { RegionAssignment, SubdistrictAssignment } from "../engine/seeding";

export interface RawSeasonFiles {
  seasonYear: number;
  /** class → CSV text */
  exports: Partial<Record<VbClass, string>>;
  /** class → region assignment HTML (C1/C2) */
  regionHtml: Partial<Record<VbClass, string>>;
  /** District / sub-district assignments page (supplies the D1/D2 sub-districts) */
  subdistrictHtml?: string;
}

export function buildSeasonData(raw: RawSeasonFiles): SeasonData {
  const matches: Match[] = [];
  const teams = new Map<string, VbClass>();
  for (const c of CLASS_ORDER) {
    const csv = raw.exports[c];
    if (!csv) continue;
    const parsed = parseNsaaExport(csv, c, raw.seasonYear);
    matches.push(...parsed.matches);
    for (const [t, cls] of parsed.teams) teams.set(t, cls);
  }
  const regions: Partial<Record<VbClass, RegionAssignment[]>> = {};
  for (const c of ["C1", "C2"] as const) {
    const html = raw.regionHtml[c];
    if (html) regions[c] = parseRegionAssignments(html);
  }
  const subdistricts: Partial<Record<VbClass, SubdistrictAssignment[]>> = {};
  if (raw.subdistrictHtml) {
    const listed = parseSubdistrictAssignments(raw.subdistrictHtml);
    for (const c of ["D1", "D2"] as const) {
      const classTeams = [...teams].filter(([, k]) => k === c).map(([n]) => n);
      const groups = Object.entries(listed)
        .filter(([id, names]) => id.startsWith(`${c}-`) && names.length > 0)
        .map(([id, names]) => ({
          id,
          teams: names.map((n) => {
            const t = matchTeamName(n, classTeams);
            if (!t) console.warn(`[load] ${id}: '${n}' doesn't match any ${c} team in the schedule export`);
            return t ?? n;
          }),
        }));
      if (groups.length > 0) subdistricts[c] = groups;
    }
  }
  const ratings = fitRatings(canonicalize(matches));
  return { matches, teams, regions, subdistricts, geo: buildGeo(), ratings };
}

export const NSAA_URLS = {
  exportCsv: (c: VbClass) =>
    `https://secure.nsaahome.org/wildcards/schedules/export.php?sport=vb&class=${c}&cutoff_only=1`,
  regions: (c: VbClass) => `https://secure.nsaahome.org/nsaaforms/regions/assignments.php?sport=vb&class=${c}`,
  regionStandings: (c: VbClass) => `https://secure.nsaahome.org/nsaaforms/regions/standings.php?sport=vb&class=${c}`,
  subdistricts: `https://secure.nsaahome.org/distassign.php?sport=vb`,
  leaders: (c: VbClass, year: number) =>
    `https://secure.nsaahome.org/wildcards/points/index.php?sport=vb&year=${year}&class=${c}`,
  bracket: (distId: number) => `https://secure.nsaahome.org/nsaaforms/officials/vbbrackets.php?distid=${distId}`,
  districtFinals: `https://secure.nsaahome.org/nsaaforms/officials/vbfinals.php`,
};

/** Fetch everything live from NSAA. Used by the scraper route and the CLI. */
export async function fetchRawSeason(seasonYear: number, classes: VbClass[] = CLASS_ORDER): Promise<RawSeasonFiles> {
  const exports: Partial<Record<VbClass, string>> = {};
  const regionHtml: Partial<Record<VbClass, string>> = {};
  await Promise.all(
    classes.map(async (c) => {
      exports[c] = await (await fetch(NSAA_URLS.exportCsv(c), { cache: "no-store" })).text();
      if (c === "C1" || c === "C2") regionHtml[c] = await (await fetch(NSAA_URLS.regions(c), { cache: "no-store" })).text();
    }),
  );
  const subdistrictHtml = await (await fetch(NSAA_URLS.subdistricts, { cache: "no-store" })).text();
  return { seasonYear, exports, regionHtml, subdistrictHtml };
}
