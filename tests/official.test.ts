import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildSeasonData } from "../src/lib/data/load";
import { parseBracketPage, parseDistrictFinals } from "../src/lib/data/parse-brackets";
import { matchTeamName } from "../src/lib/data/parse-html";
import { project, runSimulation, type SeasonData } from "../src/lib/engine/simulate";
import { compareProjection, siteHost } from "../src/lib/engine/official";
import type { OfficialClass, OfficialGroup, VbClass } from "../src/lib/engine/types";

const RAW = join(__dirname, "..", "data", "raw");
const FIX = join(__dirname, "fixtures", "nsaa");
const read = (dir: string, f: string) => readFileSync(join(dir, f), "utf8");
const CLASSES: VbClass[] = ["A", "B", "C1", "C2", "D1", "D2"];
const raw = {
  seasonYear: 2026,
  exports: Object.fromEntries(CLASSES.map((c) => [c, read(RAW, `vb_${c}.csv`)])),
  regionHtml: { C1: read(RAW, "regions_C1.html"), C2: read(RAW, "regions_C2.html") },
  subdistrictHtml: read(RAW, "subdistricts.html"),
};
const data = buildSeasonData(raw);
const CUTOFF = "2026-10-20";

describe("NSAA bracket pages (real samples)", () => {
  it("2025 B-5, classic table layout, complete: seeds, sites, every result, champion", () => {
    const p = parseBracketPage(read(FIX, "vb-bracket-2025-B5-results.html"));
    expect(p.available).toBe(true);
    expect(p.seeds.map((s) => `${s.seed} ${s.name}`)).toEqual([
      "1 Waverly",
      "2 Northwest",
      "3 Omaha Gross Catholic",
      "4 Omaha Duchesne Academy",
      "5 Ralston",
    ]);
    expect(p.games.map((g) => [g.num, g.date, g.site, g.winner, g.score?.join("-")])).toEqual([
      [1, "2025-10-28", "Duchesne", "Omaha Duchesne Academy", "3-0"],
      [2, "2025-10-30", "Northwest", "Northwest", "3-0"],
      [3, "2025-10-30", "Waverly", "Waverly", "3-0"],
      [4, "2025-11-01", "Waverly", "Waverly", "3-0"],
    ]);
    expect(p.champion?.name).toBe("Waverly");
  });
  it("2024 B-5 pairings only: default site from the title, empty slots stay empty, no results", () => {
    const p = parseBracketPage(read(FIX, "vb-bracket-2024-B5-pairings.html"));
    expect(p.defaultSite).toBe("Norris");
    expect(p.games.find((g) => g.num === 2)?.site).toBe("Lincoln Pius X");
    expect(p.games.find((g) => g.num === 3)).toMatchObject({ top: { name: "Norris", seed: 1 }, bottom: undefined });
    expect(p.games.every((g) => !g.winner)).toBe(true);
    expect(p.champion).toBeUndefined();
  });
  it('a venue listed as "TBA" counts as not decided', () => {
    const html = `<h1>Volleyball District B-1</h1><table><tr><td>#1 Norris 46.0 (30-1)</td></tr>
      <tr><td class=border><font>Match 4<br>10/31/2026<br>6:00 PM CT<br>@ TBA</font></td></tr><tr><td>#2 York 44.0 (25-5)</td></tr></table>`;
    const g = parseBracketPage(html).games[0];
    expect([g.num, g.date, g.site]).toEqual([4, "2026-10-31", undefined]);
  });
  it("unposted 2026 page is flagged unavailable", () => {
    const p = parseBracketPage(read(FIX, "vb-bracket-2026-B1-unavailable.html"));
    expect(p).toMatchObject({ available: false, games: [], seeds: [] });
  });
  it("2026 card layout (softball, double elimination): every winner inferred", () => {
    const p = parseBracketPage(read(FIX, "sb-bracket-2026-A1-cards.html"));
    expect(p.defaultSite).toBe("Millard North");
    expect(p.games.filter((g) => g.winner).map((g) => `${g.num}:${g.winner} ${g.score?.join("-")}`)).toEqual([
      "1:Bellevue East 12-0",
      "2:Papillion-La Vista South 7-1",
      "3:Millard North 10-0",
      "4:Lincoln Standing Bear 10-1",
      "5:Millard North 9-5",
      "6:Bellevue East 9-1",
      "7:Papillion-La Vista South 8-0",
      "8:Millard North 12-4",
    ]);
    expect(p.champion?.name).toBe("Millard North");
  });
  it("district finals: 2025 results and the 2026 to-be-determined page", () => {
    const done = parseDistrictFinals(read(FIX, "vb-finals-2025-results.html"));
    expect(done).toHaveLength(32);
    expect(done[0]).toEqual({
      id: "C1-1",
      date: "2025-11-01",
      time: "1:00 PM MT",
      host: "Ogallala",
      teams: [
        { name: "Ogallala", seed: 1 },
        { name: "Battle Creek", seed: 16 },
      ],
      winner: "Ogallala",
      score: [3, 0],
    });
    const tbd = parseDistrictFinals(read(FIX, "vb-finals-2026-tbd.html"));
    expect(tbd).toHaveLength(32);
    expect(tbd.every((f) => !f.teams && !f.winner && !f.host)).toBe(true);
  });
});

describe("name matching and venues", () => {
  it("matches NSAA's spellings across pages", () => {
    expect(matchTeamName("Omaha Concordia", ["Concordia Omaha", "Omaha Christian"])).toBe("Concordia Omaha");
    expect(matchTeamName("BDS", ["Bruning-Davenport-Shickley (BDS)", "Deshler"])).toBe("Bruning-Davenport-Shickley (BDS)");
    expect(matchTeamName("Nobody", ["Deshler"])).toBeUndefined();
  });
  it("maps a listed venue to the hosting team, else neutral", () => {
    expect(siteHost("Duchesne", "Omaha Duchesne Academy", "Ralston")).toBe("Omaha Duchesne Academy");
    expect(siteHost("Northwest", "Omaha Gross Catholic", "Northwest")).toBe("Northwest");
    expect(siteHost("Lexington", "Gering", "York")).toBeUndefined();
  });
  it("feeds a real bracket page through the loader with names matched to this season's teams", () => {
    const d = buildSeasonData({ ...raw, bracketHtml: { "B-5": read(FIX, "vb-bracket-2025-B5-results.html") } });
    const g = d.official.B!.groups["B-5"];
    expect(g.seeds.map((s) => s.name)).toEqual(["Waverly", "Northwest", "Omaha Gross Catholic", "Omaha Duchesne Academy", "Ralston"]);
    expect(g.games[0]).toMatchObject({ winner: "Omaha Duchesne Academy", score: [3, 0] });
    // one of seven districts posted: keep projecting
    expect(project(d, "B", CUTOFF).official).toBe(false);
  });
});

/** Official groups for a class built from our own projection, with tweaks — stands in for NSAA's Oct 22 pages. */
function officialFromProjection(vbClass: VbClass, tweak: (groups: OfficialGroup[]) => void): OfficialClass {
  const groups: OfficialGroup[] = project(data, vbClass, CUTOFF, { computedOnly: true }).groups.map((g) => ({
    id: g.id,
    seeds: g.teams.map((t) => ({ name: t.name, seed: t.seed })),
    games: [],
  }));
  tweak(groups);
  return { groups: Object.fromEntries(groups.map((g) => [g.id, g])), districtFinals: {} };
}

describe("official pairings and results in the engine", () => {
  const computed = project(data, "B", CUTOFF, { computedOnly: true });
  const b1 = computed.groups[0].teams; // B-1, five teams
  const [, , , four, five] = b1.map((t) => t.name);
  const official = officialFromProjection("B", (groups) => {
    // NSAA put two #3 seeds in each other's district…
    const [x, y] = [groups[5].seeds[2], groups[6].seeds[2]];
    [groups[5].seeds[2], groups[6].seeds[2]] = [{ ...y }, { ...x }];
    // …and #5 upset #4 on the road in B-1's opening match.
    groups[0].games = [
      {
        num: 1,
        date: "2026-10-27",
        time: "6:00 PM CT",
        site: four,
        slots: [
          { name: four, seeded: true },
          { name: five, seeded: true },
        ],
        winner: five,
        score: [3, 1],
      },
    ];
  });
  const withOfficial: SeasonData = { ...data, official: { B: official } };

  it("uses NSAA's groups once every district is posted, and reports how the projection did", () => {
    const proj = project(withOfficial, "B", CUTOFF);
    expect(proj.official).toBe(true);
    expect(proj.groups[5].teams.map((t) => t.name)).toContain(computed.groups[6].teams[2].name);
    const check = compareProjection(computed.groups, proj.groups);
    expect([check.total, check.sameGroup, check.sameGroupAndSeed, check.misses.length]).toEqual([31, 29, 29, 2]);
  });
  it("annotates the bracket with NSAA's site, time and result", () => {
    const m = project(withOfficial, "B", CUTOFF).brackets[0].matches.find((x) => x.label === "#4 vs #5")!;
    expect(m).toMatchObject({ officialSite: four, time: "6:00 PM CT", result: { winner: five, loser: four, setsW: 3, setsL: 1 } });
  });
  it("fixes posted results in every simulation run", () => {
    const n = 300;
    const res = runSimulation(withOfficial, { vbClass: "B", cutoff: CUTOFF, nSims: n, seed: 3 });
    expect(res.teams[four].wonGroup).toBe(0);
    expect(res.teams[four].opponents["group-r1"]).toEqual({ [five]: n });
    expect(res.teams[five].sites["group-r1"]).toEqual({ [four]: n });
    expect(Object.values(res.teams).reduce((s, t) => s + t.champion, 0)).toBe(n);
  });
  it("plays NSAA's district-final pairings and results (C2)", () => {
    const top16 = project(data, "C2", CUTOFF, { computedOnly: true }).overall.slice(0, 16);
    const c2 = officialFromProjection("C2", () => {});
    for (let i = 0; i < 8; i++) {
      const [hi, lo] = [top16[i], top16[15 - i]];
      c2.districtFinals[`C2-${i + 1}`] = {
        id: `C2-${i + 1}`,
        date: "2026-10-31",
        host: hi.name,
        teams: [
          { name: hi.name, seed: i + 1 },
          { name: lo.name, seed: 16 - i },
        ],
        // the #16 seed stuns the #1 seed
        ...(i === 0 ? { winner: lo.name, score: [3, 2] as [number, number] } : {}),
      };
    }
    const n = 200;
    const res = runSimulation({ ...data, official: { C2: c2 } }, { vbClass: "C2", cutoff: CUTOFF, nSims: n, seed: 5 });
    expect(res.teams[top16[0].name].reachedState).toBe(0);
    expect(res.teams[top16[15].name].reachedState).toBe(n);
    for (const t of top16) expect(res.teams[t.name].reachedDistrictFinal).toBe(n);
    expect(Object.values(res.teams).reduce((s, t) => s + t.reachedDistrictFinal, 0)).toBe(16 * n);
    expect(res.projection.districtFinals?.matches[0].result).toMatchObject({ winner: top16[15].name, setsW: 3, setsL: 2 });
  });
});
