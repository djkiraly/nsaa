import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { bracketPages, buildSeasonData, STATE_PAGE } from "../src/lib/data/load";
import { project, runSimulation, type Projection } from "../src/lib/engine/simulate";
import { teamStatuses, type StatusOdds } from "../src/lib/engine/status";
import { hasDistrictFinals } from "../src/lib/engine/brackets";
import type { Bracket, BracketMatch, SeededTeam, VbClass } from "../src/lib/engine/types";

// ---- synthetic scenarios -------------------------------------------------------------------------------------------

const seeded = (name: string, seed: number, vbClass: VbClass = "B"): SeededTeam => ({
  name,
  vbClass,
  seed,
  wins: 0,
  losses: 0,
  points: 0,
  avg: 0,
  firstDivOpponents: 0,
  oppWins: 0,
  oppLosses: 0,
});
const bracket = (id: string, name: string, teams: string[], matches: Partial<BracketMatch>[], vbClass: VbClass = "B"): Bracket => ({
  id,
  name,
  vbClass,
  teams: teams.map((n, i) => seeded(n, i + 1, vbClass)),
  matches: matches.map((m, i) => ({ id: `${id}-M${i + 1}`, round: 1, label: `M${i + 1}`, top: null, bottom: null, ...m })),
});
const won = (winner: string, loser: string, setsW = 3, setsL = 0) => ({ winner, loser, setsW, setsL });
const projection = (p: Partial<Projection> & Pick<Projection, "overall" | "brackets">): Projection => ({ groups: [], official: true, ...p });
const none: StatusOdds = { reachedState: 0, reachedDistrictFinal: 0, wildcard: 0 };
const oddsFor = (table: Record<string, Partial<StatusOdds>>) => (t: string) => ({ ...none, ...table[t] });

describe("teamStatuses — Class A/B (districts + wildcard)", () => {
  // District B-1: #2 Alliance beat #3 Ralston, then #1 Norris beat Alliance in the final. B-2 still open.
  const b1 = bracket(
    "B-1",
    "District B-1",
    ["Norris", "Alliance", "Ralston"],
    [
      { label: "#2 vs #3", top: "Alliance", bottom: "Ralston", date: "2026-10-27", result: won("Alliance", "Ralston") },
      { label: "Final", round: 2, top: "Norris", bottom: "W:B-1-M1", date: "2026-10-29", result: won("Norris", "Alliance", 3, 1) },
    ],
  );
  const b2 = bracket("B-2", "District B-2", ["Gretna", "York"], [{ label: "Final", top: "Gretna", bottom: "York", date: "2026-10-29" }]);
  const overall = ["Norris", "Gretna", "Alliance", "York", "Ralston"].map((n, i) => seeded(n, i + 1));

  it("a district champion is qualified; the losers wait on the wildcard", () => {
    const st = teamStatuses("B", projection({ overall, brackets: [b1, b2] }), oddsFor({ Alliance: { reachedState: 0.3 }, Ralston: {} }));
    expect(st.get("Norris")).toMatchObject({ kind: "qualified", won: "District B-1" });
    expect(st.get("Norris")!.summary).toBe("Won District B-1 — qualified for state");
    expect(st.get("Alliance")).toMatchObject({ kind: "at-large", pState: 0.3, loss: { opponent: "Norris", score: "3-1", stage: "district" } });
    expect(st.get("Alliance")!.summary).toContain("Lost to Norris 3-1 · District B-1 · Final, Oct 29");
    expect(st.get("Alliance")!.summary).toContain("30% to reach state");
    expect(st.get("Ralston")).toMatchObject({ kind: "likely-out", pState: 0, loss: { opponent: "Alliance", where: "District B-1 · #2 vs #3" } });
    expect(st.get("Gretna")).toMatchObject({ kind: "alive" });
    expect(st.get("Gretna")!.won).toBeUndefined();
    expect(st.get("York")!.summary).toBe("Alive · 0% to reach state");
  });

  it("once the wildcard is known, the other losers are eliminated and the wildcard is qualified", () => {
    const st = teamStatuses("B", projection({ overall, brackets: [b1, b2], wildcard: "Alliance" }), oddsFor({}));
    expect(st.get("Alliance")).toMatchObject({ kind: "qualified", summary: "Qualified for state (wildcard)" });
    expect(st.get("Ralston")).toMatchObject({ kind: "eliminated" });
    expect(st.get("Ralston")!.summary).toMatch(/^Lost to Alliance 3-0 · District B-1 · #2 vs #3, Oct 27 — missed the wildcard$/);
  });

  it("state: the field is qualified, a loss ends the season, the final's winner is champion", () => {
    const state = bracket(
      "B-ST",
      "Class B state",
      ["Norris", "Alliance"],
      [{ label: "Final", top: "Norris", bottom: "Alliance", date: "2026-11-07", result: won("Norris", "Alliance", 3, 2) }],
    );
    const st = teamStatuses("B", projection({ overall, brackets: [b1, b2], wildcard: "Alliance", state }), oddsFor({}));
    expect(st.get("Norris")).toMatchObject({ kind: "champion", summary: "State champion" });
    expect(st.get("Alliance")).toMatchObject({ kind: "eliminated", loss: { stage: "state", opponent: "Norris", score: "3-2" } });
    expect(st.get("Alliance")!.summary).toBe("Lost to Norris 3-2 · Class B state · Final, Nov 7 — season over");
    // Not played yet: the field is just qualified.
    const open = { ...state, matches: state.matches.map((m) => ({ ...m, result: undefined })) };
    const st2 = teamStatuses("B", projection({ overall, brackets: [b1, b2], wildcard: "Alliance", state: open }), oddsFor({}));
    expect(st2.get("Norris")!.kind).toBe("qualified");
    expect(st2.get("Alliance")!.kind).toBe("qualified");
  });
});

describe("teamStatuses — Class C/D (sub-districts, at-large district-final spots)", () => {
  const c1 = bracket(
    "C1-1",
    "Sub-district C1-1",
    ["Aurora", "Minden"],
    [{ label: "Final", top: "Aurora", bottom: "Minden", date: "2026-10-27", result: won("Aurora", "Minden") }],
    "C1",
  );
  const c2open = bracket("C1-2", "Sub-district C1-2", ["Pierce", "Ord"], [{ label: "Final", top: "Pierce", bottom: "Ord", date: "2026-10-27" }], "C1");
  const c2done = { ...c2open, matches: [{ ...c2open.matches[0], result: won("Pierce", "Ord", 3, 1) }] };
  const overall = ["Aurora", "Pierce", "Minden", "Ord"].map((n, i) => seeded(n, i + 1, "C1"));

  it("while sub-districts are open: winners are in the district final, losers hope for at-large on the odds", () => {
    const st = teamStatuses("C1", projection({ overall, brackets: [c1, c2open] }), oddsFor({ Minden: { reachedDistrictFinal: 0.5, reachedState: 0.2 }, Aurora: { reachedState: 0.9 } }));
    expect(st.get("Aurora")).toMatchObject({ kind: "alive", won: "Sub-district C1-1", pState: 0.9 });
    expect(st.get("Aurora")!.summary).toBe("Won Sub-district C1-1 — in the district final · 90% to reach state");
    expect(st.get("Minden")).toMatchObject({ kind: "at-large", pState: 0.2 });
    expect(st.get("Minden")!.summary).toContain("alive for an at-large district-final spot (20% to reach state)");
    const st0 = teamStatuses("C1", projection({ overall, brackets: [c1, c2open] }), oddsFor({}));
    expect(st0.get("Minden")).toMatchObject({ kind: "likely-out" });
    expect(st0.get("Minden")!.summary).toContain("waiting on other sub-districts");
  });

  it("once every sub-district is done, the at-large field is settled by the simulation: in every run, or in none", () => {
    const st = teamStatuses("C1", projection({ overall, brackets: [c1, c2done] }), oddsFor({ Minden: { reachedDistrictFinal: 1, reachedState: 0.4 }, Ord: {} }));
    expect(st.get("Minden")).toMatchObject({ kind: "alive", pState: 0.4 });
    expect(st.get("Minden")!.summary).toBe("Lost to Aurora 3-0 · Sub-district C1-1 · Final, Oct 27 — in the district final as an at-large team");
    expect(st.get("Ord")).toMatchObject({ kind: "eliminated" });
    expect(st.get("Ord")!.summary).toBe("Lost to Pierce 3-1 · Sub-district C1-2 · Final, Oct 27 — missed an at-large district-final spot");
    // A tie on averages that some runs break either way stays open.
    const tie = teamStatuses("C1", projection({ overall, brackets: [c1, c2done] }), oddsFor({ Ord: { reachedDistrictFinal: 0.5, reachedState: 0.1 } }));
    expect(tie.get("Ord")!.kind).toBe("at-large");
  });

  it("NSAA's district-final field settles it; a district-final loss ends the season; a win qualifies", () => {
    const df = bracket(
      "C1-DF",
      "District finals",
      ["Aurora", "Pierce", "Minden"],
      [
        { label: "District Final C1-1", top: "Aurora", bottom: "Minden", date: "2026-10-31", result: won("Aurora", "Minden", 3, 2) },
        { label: "District Final C1-2", top: "Pierce", bottom: "Ord", date: "2026-10-31" },
      ],
      "C1",
    );
    const st = teamStatuses("C1", projection({ overall, brackets: [c1, c2done], districtFinals: df }), oddsFor({ Ord: { reachedDistrictFinal: 0.5 } }));
    expect(st.get("Aurora")).toMatchObject({ kind: "qualified", won: "District Final C1-1", summary: "Won District Final C1-1 — qualified for state" });
    expect(st.get("Minden")).toMatchObject({ kind: "eliminated", loss: { stage: "district-final", score: "3-2" } });
    expect(st.get("Minden")!.summary).toBe("Lost to Aurora 3-2 · District finals · District Final C1-1, Oct 31 — season over");
    expect(st.get("Pierce")!.kind).toBe("alive");
    // Ord isn't in NSAA's field: out, whatever the simulation thought.
    expect(st.get("Ord")!.kind).toBe("eliminated");
  });
});

// ---- today's data -----------------------------------------------------------------------------------------------

const RAW = join(__dirname, "..", "data", "raw");
const read = (f: string) => (existsSync(join(RAW, f)) ? readFileSync(join(RAW, f), "utf8") : undefined);
const CLASSES: VbClass[] = ["A", "B", "C1", "C2", "D1", "D2"];
const data = buildSeasonData({
  seasonYear: 2026,
  exports: Object.fromEntries(CLASSES.map((c) => [c, read(`vb_${c}.csv`)!])),
  regionHtml: { C1: read("regions_C1.html")!, C2: read("regions_C2.html")! },
  subdistrictHtml: read("subdistricts.html"),
  districtFinalsHtml: read("district_finals.html"),
  bracketHtml: Object.fromEntries(
    [...bracketPages().map(([id]) => id), STATE_PAGE.id].map((id) => [id, read(`brackets/${id}.html`)]).filter(([, h]) => h) as [string, string][],
  ),
});

describe("statuses on the current NSAA data", () => {
  for (const c of CLASSES) {
    it(`${c}: every team has one, and a status is consistent with the posted results`, () => {
      const proj = project(data, c, "2026-10-20");
      const sim = runSimulation(data, { vbClass: c, cutoff: "2026-10-20", nSims: 200, seed: 7, picks: {} });
      const n = sim.nSims;
      const st = teamStatuses(c, proj, (t) => ({
        reachedState: sim.teams[t].reachedState / n,
        reachedDistrictFinal: sim.teams[t].reachedDistrictFinal / n,
        wildcard: sim.teams[t].wildcard / n,
      }));
      expect([...st.keys()].sort()).toEqual(proj.overall.map((t) => t.name).sort());
      const losers = new Set(proj.brackets.flatMap((b) => b.matches).map((m) => m.result?.loser).filter(Boolean));
      const groupsDone = proj.brackets.every((b) => b.matches.at(-1)!.result);
      for (const [team, s] of st) {
        // Only a loss puts a team on the bubble or out; a team that hasn't lost is alive or through.
        if (s.kind === "at-large" || s.kind === "likely-out" || s.kind === "eliminated") expect(s.loss, team).toBeDefined();
        if (!losers.has(team) && !proj.districtFinals && !proj.state) expect(["alive", "qualified"], `${team}: ${s.summary}`).toContain(s.kind);
        // Nobody is eliminated by a district / sub-district loss until the at-large field (C/D) or wildcard (A/B) is settled.
        if (s.kind === "eliminated" && s.loss!.stage === "district") {
          if (hasDistrictFinals(c)) expect(groupsDone || !!proj.districtFinals, team).toBe(true);
          else expect(proj.wildcard, team).toBeDefined();
        }
        // The simulation agrees: a team the status calls out never reaches state in any run.
        if (s.kind === "eliminated" || s.kind === "likely-out") expect(sim.teams[team].reachedState, team).toBe(0);
      }
      // C/D with every sub-district final in and no district-final results yet: exactly 16 teams are left.
      if (hasDistrictFinals(c) && groupsDone && !proj.districtFinals?.matches.some((m) => m.result)) {
        const alive = [...st.values()].filter((s) => s.kind === "alive" || s.kind === "at-large");
        expect(alive.length).toBe(16);
        expect([...st.values()].filter((s) => s.kind === "eliminated").length).toBe(proj.overall.length - 16);
      }
    });
  }
});
