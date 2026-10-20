/**
 * District / sub-district formation per the 2026 NSAA Volleyball Manual.
 *
 * Class A/B — 7 districts by un-modified serpentine over the wildcard seeds (A: 34 teams, B: 31):
 *              D1  D2  D3  D4  D5  D6  D7
 *               1   2   3   4   5   6   7
 *              14  13  12  11  10   9   8
 *              15  16  17  18  19  20  21
 *              28  27  26  25  24  23  22
 *              29  30  31 (32  33  34)
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
 *
 * Class D1/D2 — 12 sub-districts assigned geographically by the NSAA (distassign.php); teams are seeded within
 *   their sub-district by wildcard average.
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

/** NSAA bracket page ids (vbbrackets.php?distid=N), in district / sub-district order. */
export const DIST_IDS: Record<VbClass, number[]> = {
  A: [2, 3, 4, 5, 6, 7, 87],
  B: [8, 9, 10, 11, 12, 13, 88],
  C1: [38, 39, 40, 41, 42, 43, 44, 45, 46, 47],
  C2: [50, 51, 52, 53, 54, 55, 56, 57, 58, 59],
  D1: [62, 63, 64, 65, 66, 67, 68, 69, 70, 71, 72, 73],
  D2: [74, 75, 76, 77, 78, 79, 80, 81, 82, 83, 84, 85],
};

/** Class A/B: 7 districts. Returns groups with intra-district seeds 1..n. */
export function formSerpentineDistricts(
  vbClass: "A" | "B",
  records: TeamRecord[],
  matches: Match[],
  rng?: () => number,
): { overall: SeededTeam[]; groups: Group[] } {
  const ranked = withSeeds(rankByWildcard(records, matches, rng));
  const parts = serpentine(ranked, 7);
  const groups: Group[] = parts.map((teams, i) => ({
    id: `${vbClass}-${i + 1}`,
    name: `District ${vbClass}-${i + 1}`,
    vbClass,
    distId: DIST_IDS[vbClass][i],
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
  const distIds = DIST_IDS[vbClass];
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

export interface SubdistrictAssignment {
  /** e.g. "D1-7" */
  id: string;
  teams: string[];
}

/** Class D1/D2: NSAA-assigned sub-districts, seeded internally by wildcard average. */
export function formAssignedSubdistricts(
  vbClass: "D1" | "D2",
  assignments: SubdistrictAssignment[],
  records: TeamRecord[],
  matches: Match[],
  rng?: () => number,
): { overall: SeededTeam[]; groups: Group[] } {
  const byName = new Map(records.map((r) => [r.name, r]));
  const overall = withSeeds(rankByWildcard(records, matches, rng));
  const num = (id: string) => Number(id.split("-")[1]);
  const groups = [...assignments]
    .sort((a, b) => num(a.id) - num(b.id))
    .map((a): Group => {
      const recs = a.teams.map((t) => byName.get(t)).filter((r): r is TeamRecord => !!r);
      return {
        id: a.id,
        name: `Sub-district ${a.id}`,
        vbClass,
        distId: DIST_IDS[vbClass][num(a.id) - 1],
        teams: rankByWildcard(recs, matches, rng).map((t, j) => ({ ...t, seed: j + 1 })),
      };
    });
  return { overall, groups };
}
