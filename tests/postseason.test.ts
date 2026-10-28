import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { bracketPages, buildSeasonData, STATE_PAGE } from "../src/lib/data/load";
import { project } from "../src/lib/engine/simulate";
import { exportPostseasonGames, fillResults, isPostseasonEvent, PostedResults, type PostedGame } from "../src/lib/engine/postseason";
import type { Bracket, Match, VbClass } from "../src/lib/engine/types";

const row = (team: string, opponent: string, date: string, won: boolean, tournament?: string): Match => ({
  date,
  team,
  opponent,
  opponentClass: "B",
  opponentWins: 0,
  opponentLosses: 0,
  opponentDivision: 1,
  away: false,
  played: true,
  won,
  setsFor: won ? 3 : 1,
  setsAgainst: won ? 1 : 3,
  tournament,
});
const game = (winner: string, loser: string, date: string, inExport = true): PostedGame => ({ winner, loser, date, setsW: 3, setsL: 0, inExport });

describe("postseason rows in the schedule export", () => {
  it("recognizes NSAA's postseason tournament names", () => {
    for (const t of ["District B-1", "Subdistrict C2-4", "Sub-District D1-12", "State Championships", "district final"]) expect(isPostseasonEvent(t), t).toBe(true);
    for (const t of [undefined, "", "Conference Tournament", "Districts Invite".replace("Districts", "Tri-County")]) expect(isPostseasonEvent(t), String(t)).toBe(false);
  });
  it("yields one game per match (both teams list it) with the winner's sets first", () => {
    const games = exportPostseasonGames([
      row("Norris", "Alliance", "2026-10-29", true, "District B-1"),
      row("Alliance", "Norris", "2026-10-29", false, "District B-1"),
      row("Norris", "Gretna", "2026-09-01", true, "Conference"),
      { ...row("York", "Seward", "2026-10-31", true, "District B-2"), played: false, won: undefined },
    ]);
    expect(games).toEqual([{ date: "2026-10-29", winner: "Norris", loser: "Alliance", setsW: 3, setsL: 1, inExport: true }]);
  });
});

describe("PostedResults", () => {
  const posted = new PostedResults([game("Norris", "Alliance", "2026-10-27"), game("Norris", "Alliance", "2026-11-05", false), game("York", "Seward", "2026-10-29", false)]);
  it("finds a pair's game on its date, either way round", () => {
    expect(posted.find("Alliance", "Norris", "2026-10-27")?.date).toBe("2026-10-27");
    expect(posted.find("Norris", "Alliance", "2026-11-05")?.inExport).toBe(false);
  });
  it("takes the nearest game within a few days (a moved match), none beyond", () => {
    expect(posted.find("Norris", "Alliance", "2026-10-29")?.date).toBe("2026-10-27");
    expect(posted.find("Norris", "Alliance", "2026-11-01")).toBeUndefined();
    expect(posted.find("Norris", "Alliance", "2026-11-02", 4)?.date).toBe("2026-11-05");
  });
  it("without a date, only an unambiguous pair matches", () => {
    expect(posted.find("York", "Seward", undefined)?.winner).toBe("York");
    expect(posted.find("Norris", "Alliance", undefined)).toBeUndefined();
    expect(posted.find("Norris", "Gretna", "2026-10-27")).toBeUndefined();
  });
  it("prefers the export's copy of a game over a bracket page's, and counts each game once", () => {
    const p = new PostedResults([game("A", "B", "2026-10-27", false), game("A", "B", "2026-10-27", true), game("A", "B", "2026-10-27", false)]);
    expect(p.size).toBe(1);
    expect(p.find("A", "B", "2026-10-27")?.inExport).toBe(true);
  });
});

describe("fillResults", () => {
  it("fills matches in round order so a later match's teams follow from earlier results", () => {
    const br: Bracket = {
      id: "B-1",
      name: "District B-1",
      vbClass: "B",
      teams: [],
      matches: [
        { id: "B-1-M2", round: 2, label: "Final", top: "Norris", bottom: "W:B-1-M1", date: "2026-10-29" },
        { id: "B-1-M1", round: 1, label: "#2 vs #3", top: "Alliance", bottom: "Ralston", date: "2026-10-27" },
      ],
    };
    const posted = new PostedResults([game("Alliance", "Ralston", "2026-10-27"), game("Norris", "Alliance", "2026-10-29")]);
    const filled = fillResults(br, posted);
    expect(filled.matches.map((m) => m.result?.winner)).toEqual(["Norris", "Alliance"]);
    expect(filled.matches[0].result).toMatchObject({ loser: "Alliance", setsW: 3, setsL: 0 });
    // The input is untouched; an existing result is kept.
    expect(br.matches.every((m) => !m.result)).toBe(true);
    const kept = fillResults({ ...br, matches: [{ ...br.matches[1], result: { winner: "Ralston", loser: "Alliance" } }, br.matches[0]] }, posted);
    expect(kept.matches.find((m) => m.id === "B-1-M1")!.result!.winner).toBe("Ralston");
    expect(kept.matches.find((m) => m.id === "B-1-M2")!.result).toBeUndefined();
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

describe("posted results on the current NSAA data", () => {
  it("the schedule export carries postseason results", () => {
    expect(data.posted.size).toBeGreaterThan(0);
  });
  for (const c of CLASSES) {
    it(`${c}: every bracket result agrees with the export, and every export result is on the bracket`, () => {
      const proj = project(data, c, "2026-10-20");
      const matches = [...proj.brackets, ...(proj.districtFinals ? [proj.districtFinals] : []), ...(proj.state ? [proj.state] : [])].flatMap((b) => b.matches);
      const teamOf = (ref: string | null) => (ref?.startsWith("W:") ? matches.find((m) => m.id === ref.slice(2))?.result?.winner : ref);
      for (const m of matches) {
        const [a, b] = [teamOf(m.top), teamOf(m.bottom)];
        if (!a || !b) continue;
        const g = data.posted.find(a, b, m.date);
        if (m.result && g) expect(g.winner, `${m.id} ${m.date}`).toBe(m.result.winner);
        if (g && !m.result) throw new Error(`${m.id}: ${g.winner} def. ${g.loser} on ${g.date} is in the export but not on the bracket`);
      }
    });
  }
});
