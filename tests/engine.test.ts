import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { bracketPages, buildSeasonData } from "../src/lib/data/load";
import {
  parseWildcardLeaders,
  parseRegionAssignments,
  parseSubdistrictAssignments,
} from "../src/lib/data/parse-html";
import { computeRecord, matchPoints, divisionFor, classBonus } from "../src/lib/engine/wildcard";
import { serpentine } from "../src/lib/engine/seeding";
import { project, runSimulation } from "../src/lib/engine/simulate";
import { compareProjection } from "../src/lib/engine/official";
import { matchWinProb } from "../src/lib/engine/ratings";
import type { VbClass } from "../src/lib/engine/types";

const RAW = join(__dirname, "..", "data", "raw");
const read = (f: string) => readFileSync(join(RAW, f), "utf8");
const CLASSES: VbClass[] = ["A", "B", "C1", "C2", "D1", "D2"];

const raw = {
  seasonYear: 2026,
  exports: Object.fromEntries(CLASSES.map((c) => [c, read(`vb_${c}.csv`)])),
  regionHtml: { C1: read("regions_C1.html"), C2: read("regions_C2.html") },
  subdistrictHtml: read("subdistricts.html"),
};
const data = buildSeasonData(raw);
/**
 * The exports as they stood on Oct 23, when NSAA had posted pairings but no results. Seeding is checked against these:
 * NSAA's export now carries every match since (postseason included) with today's records, so seeding-day numbers
 * can't be rebuilt from the current files.
 */
const SEEDING = join(__dirname, "fixtures", "nsaa", "seeding-2026-10-23");
const seedingRaw = { ...raw, exports: Object.fromEntries(CLASSES.map((c) => [c, readFileSync(join(SEEDING, `vb_${c}.csv`), "utf8")])) };
const seeding = buildSeasonData(seedingRaw);
const classTeams = (c: VbClass) => [...data.teams].filter(([, k]) => k === c).map(([n]) => n);

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
  for (const c of CLASSES) {
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
  it("Gering = 27-5, 44.6250 at the Oct 20 cutoff (seeding snapshot; NSAA's B-5 bracket page: 44.6250 pts)", () => {
    const g = computeRecord("Gering", "B", seeding.matches);
    expect(g.wins).toBe(27);
    expect(g.losses).toBe(5);
    expect(g.avg).toBeCloseTo(44.625, 4);
    expect(g.points).toBe(1428);
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
  it("the rule-based projection reproduces NSAA's official 2026 groups and seeds in every class", () => {
    const bracketHtml = Object.fromEntries(bracketPages().map(([id]) => [id, read(`brackets/${id}.html`)]));
    const withOfficial = buildSeasonData({ ...seedingRaw, bracketHtml });
    for (const c of CLASSES) {
      const official = project(withOfficial, c, "2026-10-20");
      expect(official.official).toBe(true);
      const check = compareProjection(project(seeding, c, "2026-10-20").groups, official.groups);
      expect(check.misses, `${c}: ${JSON.stringify(check.misses)}`).toEqual([]);
      expect(check.total).toBe(classTeams(c).length);
    }
  });
  it("Class A: 34 teams serpentine into six 5-team districts and a 4-team A-7; higher seed always hosts", () => {
    const proj = project(seeding, "A", "2026-10-31");
    expect(proj.overall).toHaveLength(34);
    expect(proj.groups.map((g) => g.teams.length)).toEqual([5, 5, 5, 5, 5, 5, 4]);
    expect(proj.groups[6].teams.map((t) => proj.overall.findIndex((o) => o.name === t.name) + 1)).toEqual([7, 8, 21, 22]);
    for (const b of proj.brackets) for (const m of b.matches) expect(m.site).toBeUndefined();
    const r1 = proj.brackets[0].matches.find((m) => m.label === "#4 vs #5")!;
    expect([r1.date, r1.host]).toEqual(["2026-10-26", proj.groups[0].teams[3].name]);
  });
  it("D1/D2: 12 NSAA-assigned sub-districts each, covering every team once; #1 seed hosts everything", () => {
    const listed = parseSubdistrictAssignments(read("subdistricts.html"));
    for (const c of ["D1", "D2"] as const) {
      expect(Object.keys(listed).filter((k) => k.startsWith(`${c}-`))).toHaveLength(12);
      const proj = project(seeding, c, "2026-10-31");
      expect(proj.groups.map((g) => g.id)).toEqual(Array.from({ length: 12 }, (_, i) => `${c}-${i + 1}`));
      const assigned = proj.groups.flatMap((g) => g.teams.map((t) => t.name));
      expect(assigned.sort()).toEqual(classTeams(c).sort());
      for (const b of proj.brackets) {
        const one = b.teams[0].name;
        for (const m of b.matches) expect(m.host).toBe(one);
        expect(b.matches.at(-1)!.date).toBe("2026-10-27");
      }
    }
  });
  it("Class B districts: Norris #1 in B-1, Gering #1 in B-5", () => {
    const proj = project(seeding, "B", "2026-10-31");
    expect(proj.overall[0].name).toBe("Norris");
    const gering = proj.groups.find((g) => g.teams.some((t) => t.name === "Gering"))!;
    expect(gering.id).toBe("B-5");
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
  for (const c of CLASSES) {
    it(`runs Class ${c} end to end with sane totals`, () => {
      const res = runSimulation(data, { vbClass: c, cutoff: "2026-10-20", nSims: 200, seed: 7 });
      const teams = Object.values(res.teams);
      const sum = (f: (t: (typeof teams)[number]) => number) => teams.reduce((s, t) => s + f(t), 0);
      expect(sum((t) => t.champion)).toBe(200);
      expect(sum((t) => t.reachedState)).toBe(200 * 8);
      expect(sum((t) => t.wonGroup)).toBe(200 * res.projection.groups.length);
      if (c === "A" || c === "B") expect(sum((t) => t.wildcard)).toBe(200);
      else expect(sum((t) => t.reachedDistrictFinal)).toBe(200 * 16);
    });
  }
});
