import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildSeasonData } from "../src/lib/data/load";
import { parseWildcardLeaders, parseRegionAssignments, parseRegionStandingsSubdistricts } from "../src/lib/data/parse-html";
import { computeRecord, matchPoints, divisionFor, classBonus } from "../src/lib/engine/wildcard";
import { serpentine } from "../src/lib/engine/seeding";
import { project, runSimulation } from "../src/lib/engine/simulate";
import { matchWinProb } from "../src/lib/engine/ratings";
import type { VbClass } from "../src/lib/engine/types";

const RAW = join(__dirname, "..", "data", "raw");
const read = (f: string) => readFileSync(join(RAW, f), "utf8");
const CLASSES: VbClass[] = ["A", "B", "C1", "C2", "D1", "D2"];

const data = buildSeasonData({
  seasonYear: 2026,
  exports: Object.fromEntries(CLASSES.map((c) => [c, read(`vb_${c}.csv`)])),
  regionHtml: { C1: read("regions_C1.html"), C2: read("regions_C2.html") },
});

describe("wildcard formula", () => {
  it("matches the manual's point table", () => {
    expect(matchPoints("B", "B", 4, true)).toBe(41);
    expect(matchPoints("B", "C2", 1, false)).toBe(39);
    expect(matchPoints("B", "A", 2, true)).toBe(49); // 47 + 2 (one class up)
    expect(matchPoints("B", "A", 3, false)).toBe(35); // 33 + 2
    expect(matchPoints("A", "A", 1, true)).toBe(52);
    expect(matchPoints("D1", "A", 1, true)).toBe(55); // 50 + 5 (four up)
    expect(classBonus("C2", "C1")).toBe(2);
    expect(classBonus("C2", "D1")).toBe(0);
  });
  it("divisions", () => {
    expect(divisionFor(15, 5)).toBe(1);
    expect(divisionFor(10, 10)).toBe(2);
    expect(divisionFor(5, 15)).toBe(3);
    expect(divisionFor(4, 16)).toBe(4);
  });
});

describe("reproduces NSAA published averages", () => {
  for (const c of ["B", "C2"] as const) {
    it(`class ${c}: every team's record and average matches the leaders page`, () => {
      const leaders = parseWildcardLeaders(read(`points_${c}.html`));
      expect(leaders.length).toBeGreaterThan(20);
      const mismatches: string[] = [];
      for (const row of leaders) {
        const rec = computeRecord(row.school, c, data.matches);
        if (rec.wins !== row.wins || rec.losses !== row.losses || Math.abs(rec.avg - row.avg) > 0.0001) {
          mismatches.push(`${row.school}: ours ${rec.wins}-${rec.losses} ${rec.avg.toFixed(4)} vs NSAA ${row.wins}-${row.losses} ${row.avg}`);
        }
      }
      expect(mismatches, mismatches.join("\n")).toEqual([]);
    });
  }
  it("Gering = 26-5, 44.4516 through the Oct 19 snapshot", () => {
    const g = computeRecord("Gering", "B", data.matches);
    expect(g.wins).toBe(26);
    expect(g.losses).toBe(5);
    expect(g.avg).toBeCloseTo(44.4516, 4);
    expect(g.points).toBe(1378);
  });
});

describe("seeding", () => {
  it("serpentine matches the manual's Class B table", () => {
    const seeds = Array.from({ length: 31 }, (_, i) => i + 1);
    const g = serpentine(seeds, 7);
    expect(g[0]).toEqual([1, 14, 15, 28, 29]);
    expect(g[1]).toEqual([2, 13, 16, 27, 30]);
    expect(g[6]).toEqual([7, 8, 21, 22]);
  });
  it("parses C2 regions (4 regions, Region 4 = 5 teams)", () => {
    const regions = parseRegionAssignments(read("regions_C2.html"));
    expect(regions.map((r) => r.teams.length)).toEqual([17, 16, 17, 5]);
    expect(regions[3].teams).toContain("Mitchell");
  });
  it("C2 sub-districts match NSAA's live standings page (same snapshot)", () => {
    const nsaa = parseRegionStandingsSubdistricts(read("standings_C2.html"));
    expect(Object.keys(nsaa).sort()).toEqual(["C2-1","C2-10","C2-2","C2-3","C2-4","C2-5","C2-6","C2-7","C2-8","C2-9"]);
    const proj = project(data, "C2", "2026-10-31");
    const ours = Object.fromEntries(proj.groups.map((g) => [g.id, g.teams.map((t) => t.name)]));
    expect(ours).toEqual(nsaa);
  });
  it("Class B districts: Norris #1 in B-1, Gering in B-6", () => {
    const proj = project(data, "B", "2026-10-31");
    expect(proj.overall[0].name).toBe("Norris");
    const gering = proj.groups.find((g) => g.teams.some((t) => t.name === "Gering"))!;
    expect(gering.id).toBe("B-6");
    expect(gering.teams[0].name).toBe("Gering");
  });
});

describe("ratings", () => {
  it("home advantage is positive and plausible; Norris rated above Schuyler", () => {
    expect(data.ratings.home).toBeGreaterThan(0);
    expect(data.ratings.home).toBeLessThan(1);
    expect(data.ratings.rating.get("Norris")!).toBeGreaterThan(data.ratings.rating.get("Schuyler")!);
  });
  it("best-of-5 amplifies set edge", () => {
    expect(matchWinProb(0.5, 5)).toBeCloseTo(0.5, 6);
    expect(matchWinProb(0.6, 5)).toBeGreaterThan(0.68);
    expect(matchWinProb(0.6, 3)).toBeLessThan(matchWinProb(0.6, 5));
  });
});

describe("simulation", () => {
  it("runs Class B and C2 end to end with sane totals", () => {
    for (const c of ["B", "C2"] as const) {
      const res = runSimulation(data, { vbClass: c, cutoff: "2026-10-20", nSims: 200, seed: 7 });
      const teams = Object.values(res.teams);
      const champions = teams.reduce((s, t) => s + t.champion, 0);
      const stateApps = teams.reduce((s, t) => s + t.reachedState, 0);
      expect(champions).toBe(200);
      expect(stateApps).toBe(200 * 8);
      if (c === "B") expect(teams.reduce((s, t) => s + t.wildcard, 0)).toBe(200);
      if (c === "C2") expect(teams.reduce((s, t) => s + t.reachedDistrictFinal, 0)).toBe(200 * 16);
    }
  });
});
