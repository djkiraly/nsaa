import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { bracketPages, buildSeasonData } from "../src/lib/data/load";
import { project, runSimulation } from "../src/lib/engine/simulate";
import { matchTeams, matchWinner, prunePicks } from "../src/lib/engine/picks";
import type { Bracket, VbClass } from "../src/lib/engine/types";

const RAW = join(__dirname, "..", "data", "raw");
const read = (f: string) => readFileSync(join(RAW, f), "utf8");
const CLASSES: VbClass[] = ["A", "B", "C1", "C2", "D1", "D2"];
const data = buildSeasonData({
  seasonYear: 2026,
  exports: Object.fromEntries(CLASSES.map((c) => [c, read(`vb_${c}.csv`)])),
  regionHtml: { C1: read("regions_C1.html"), C2: read("regions_C2.html") },
  subdistrictHtml: read("subdistricts.html"),
  bracketHtml: Object.fromEntries(bracketPages().map(([id]) => [id, read(`brackets/${id}.html`)])),
});
const CUTOFF = "2026-10-20";
// Official B-1: M1 #4 Alliance v #5 Ralston → M2 #1 Norris v W(M1); M3 #2 Scottsbluff v #3 South Sioux City; M4 final.
const b1 = project(data, "B", CUTOFF).brackets[0];

describe("bracket picks", () => {
  it("a pick sends its team on; later matches see who's in them", () => {
    expect(matchTeams(b1, b1.matches[1], {})).toEqual(["Norris", null]);
    const picks = { "B-1-M1": "Ralston", "B-1-M2": "Ralston" };
    expect(matchTeams(b1, b1.matches[1], picks)).toEqual(["Norris", "Ralston"]);
    expect(matchTeams(b1, b1.matches[3], picks)).toEqual(["Ralston", null]);
    expect(matchWinner(b1, b1.matches[1], picks)).toBe("Ralston");
  });
  it("changing an earlier pick drops later picks that can't happen any more, and picks on posted results", () => {
    const picks = { "B-1-M1": "Ralston", "B-1-M2": "Ralston", "B-1-M3": "Scottsbluff" };
    expect(prunePicks([b1], { ...picks, "B-1-M1": "Alliance" })).toEqual({ "B-1-M1": "Alliance", "B-1-M3": "Scottsbluff" });
    expect(prunePicks([b1], picks)).toBe(picks);
    const played: Bracket = {
      ...b1,
      matches: b1.matches.map((m, i) => (i === 0 ? { ...m, result: { winner: "Alliance", loser: "Ralston", setsW: 3, setsL: 0 } } : m)),
    };
    expect(prunePicks([played], picks)).toEqual({ "B-1-M3": "Scottsbluff" });
  });
});

describe("simulating with picks", () => {
  const n = 300;
  it("picked winners win every run and feed later rounds, seeding and state", () => {
    const res = runSimulation(data, {
      vbClass: "B",
      cutoff: CUTOFF,
      nSims: n,
      seed: 11,
      picks: { "B-1-M1": "Ralston", "B-1-M2": "Ralston", "B-1-M4": "Ralston" },
    });
    expect(res.matchWins["B-1-M1"]).toEqual({ Ralston: n });
    expect(res.matchWins["B-1-M2"]).toEqual({ Ralston: n });
    expect(res.teams.Norris.wonGroup).toBe(0);
    expect(res.teams.Ralston.wonGroup).toBe(n);
    expect(res.teams.Ralston.reachedState).toBe(n);
    // Norris (34-1) can still get the wildcard
    expect(res.teams.Norris.wildcard).toBeGreaterThan(0);
    expect(Object.values(res.teams).reduce((s, t) => s + t.champion, 0)).toBe(n);
  });
  it("a pick for a team that isn't in the match changes nothing; a state pick holds whenever the team gets there", () => {
    const base = runSimulation(data, { vbClass: "B", cutoff: CUTOFF, nSims: n, seed: 11 });
    const stray = runSimulation(data, { vbClass: "B", cutoff: CUTOFF, nSims: n, seed: 11, picks: { "B-1-M1": "Gering" } });
    expect(stray.teams.Gering.champion).toBe(base.teams.Gering.champion);
    expect(stray.matchWins["B-1-M1"]).toEqual(base.matchWins["B-1-M1"]);
    const title = runSimulation(data, { vbClass: "B", cutoff: CUTOFF, nSims: n, seed: 11, picks: { "B-ST-F": "Gering" } });
    expect(title.teams.Gering.champion).toBe(title.teams.Gering.wonStateSemi);
    expect(title.teams.Gering.champion).toBeGreaterThan(base.teams.Gering.champion);
  });
  it("tallies every match's winners (each match counted once per run it's played)", () => {
    const res = runSimulation(data, { vbClass: "C1", cutoff: CUTOFF, nSims: 100, seed: 2 });
    for (const b of project(data, "C1", CUTOFF).brackets)
      for (const m of b.matches) expect(Object.values(res.matchWins[m.id]).reduce((s, x) => s + x, 0), m.id).toBe(100);
    expect(Object.values(res.matchWins["C1-ST-F"]).reduce((s, x) => s + x, 0)).toBe(100);
  });
});
