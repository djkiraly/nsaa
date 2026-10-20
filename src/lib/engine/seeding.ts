/**
 * District / sub-district formation per the 2026 NSAA Volleyball Manual.
 *
 * Class B  — 7 districts by un-modified serpentine over the 31 wildcard seeds:
 *              D1  D2  D3  D4  D5  D6  D7
 *               1   2   3   4   5   6   7
 *              14  13  12  11  10   9   8
 *              15  16  17  18  19  20  21
 *              28  27  26  25  24  23  22
 *              29  30  31
 *
 * Class C1/C2 — 4 geographic regions. The westernmost region (Region 4) is a
 *   single sub-district (C2-10). Each other region serpentines its own teams
 *   (ranked by wildcard average) into 3 sub-districts of 4–6:
 *              S1  S2  S3
 *               1   2   3
 *               6   5   4
 *               7   8   9
 *              12  11  10
 *              13  14  15
 *                  17  16      (16/17-team regions)
 */
import type { Match, SeededTeam, TeamRecord, VbClass } from "./types";
import { rankByWildcard } from "./wildcard";

export interface Group {
  /** e.g. "B-3" or "C2-7" */
  id: string;
  name: string;
  vbClass: VbClass;
  /** NSAA bracket page distid, when known */
  distId?: number;
  teams: SeededTeam[];
}

/** Un-modified serpentine: distribute an ordered list across n groups. */
export function serpentine<T>(ordered: T[], n: number): T[][] {
  const groups: T[][] = Array.from({ length: n }, () => []);
  ordered.forEach((item, i) => {
    const row = Math.floor(i / n);
    const col = i % n;
    const g = row % 2 === 0 ? col : n - 1 - col;
    groups[g].push(item);
  });
  return groups;
}

function withSeeds(records: TeamRecord[]): SeededTeam[] {
  return records.map((r, i) => ({ ...r, seed: i + 1 }));
}

export const CLASS_B_DIST_IDS = [8, 9, 10, 11, 12, 13, 88];
export const CLASS_C2_DIST_IDS = [50, 51, 52, 53, 54, 55, 56, 57, 58, 59];
export const CLASS_C1_DIST_IDS = [38, 39, 40, 41, 42, 43, 44, 45, 46, 47];

/** Class B: 7 districts. Returns groups with intra-district seeds 1..n. */
export function formClassBDistricts(
  records: TeamRecord[],
  matches: Match[],
  rng?: () => number,
): { overall: SeededTeam[]; groups: Group[] } {
  const ranked = withSeeds(rankByWildcard(records, matches, rng));
  const parts = serpentine(ranked, 7);
  const groups: Group[] = parts.map((teams, i) => ({
    id: `B-${i + 1}`,
    name: `District B-${i + 1}`,
    vbClass: "B",
    distId: CLASS_B_DIST_IDS[i],
    // intra-district seed: order by overall rank (already sorted within serpentine)
    teams: teams.map((t, j) => ({ ...t, seed: j + 1 })),
  }));
  return { overall: ranked, groups };
}

export interface RegionAssignment {
  /** region number 1..4 */
  region: number;
  teams: string[];
}

/**
 * Class C1/C2: regions → sub-districts.
 * `regions` must have 4 entries; region 4 is the west (single sub-district).
 */
export function formRegionSubdistricts(
  vbClass: "C1" | "C2",
  regions: RegionAssignment[],
  records: TeamRecord[],
  matches: Match[],
  rng?: () => number,
): { overall: SeededTeam[]; groups: Group[] } {
  const byName = new Map(records.map((r) => [r.name, r]));
  const overall = withSeeds(rankByWildcard(records, matches, rng));
  const distIds = vbClass === "C2" ? CLASS_C2_DIST_IDS : CLASS_C1_DIST_IDS;
  const groups: Group[] = [];
  let sub = 1;
  for (const region of [...regions].sort((a, b) => a.region - b.region)) {
    const recs = region.teams
      .map((t) => byName.get(t))
      .filter((r): r is TeamRecord => !!r);
    const ranked = rankByWildcard(recs, matches, rng);
    const n = region.region === 4 ? 1 : 3;
    const parts = serpentine(ranked, n);
    for (const teams of parts) {
      groups.push({
        id: `${vbClass}-${sub}`,
        name: `Sub-district ${vbClass}-${sub}`,
        vbClass,
        distId: distIds[sub - 1],
        teams: teams.map((t, j) => ({ ...t, seed: j + 1 })),
      });
      sub++;
    }
  }
  return { overall, groups };
}
