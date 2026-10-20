/**
 * Tool definitions + implementations for the chat agent.
 * Each tool returns plain JSON the model can reason over.
 */
import type Anthropic from "@anthropic-ai/sdk";
import { getProjection, getSimulation, loadSeason, SEEDING_CUTOFF, SUPPORTED_CLASSES } from "../data/season";
import { NSAA_URLS } from "../data/load";
import { parseBracketPage, parseDistrictFinals } from "../data/parse-html";
import { matchWinProb, setWinProb } from "../engine/ratings";
import { distanceMiles } from "../engine/geo";
import { computeRecord } from "../engine/wildcard";
import type { VbClass } from "../engine/types";
import type { Stage, TeamSimStats } from "../engine/simulate";
import { RULES_SUMMARY } from "./rules";

type Json = Record<string, unknown>;

const classParam = {
  type: "string" as const,
  enum: SUPPORTED_CLASSES,
  description: "NSAA volleyball class (B or C2 supported this version)",
};

export const TOOL_DEFS: Anthropic.Tool[] = [
  {
    name: "get_standings",
    description:
      "Current wildcard standings for a class through the seeding cutoff: record, wildcard average, overall seed, projected district/sub-district and seed, and the model's power rating. Use this before anything else when asked about a class.",
    input_schema: { type: "object", properties: { vbClass: classParam }, required: ["vbClass"] },
  },
  {
    name: "get_projected_brackets",
    description:
      "Projected district (B) or sub-district (C2) groupings and bracket pairings with hosts/sites and dates, computed from current wildcard averages using the NSAA serpentine rules. Optionally filter to one group id like 'B-6' or 'C2-7'.",
    input_schema: {
      type: "object",
      properties: { vbClass: classParam, groupId: { type: "string", description: "e.g. B-6 or C2-7" } },
      required: ["vbClass"],
    },
  },
  {
    name: "simulate_postseason",
    description:
      "Monte Carlo simulation (default 2000 runs) of the full postseason: probability each team wins its district/sub-district, qualifies for the district final (C2) or the wildcard (B), reaches state, and wins the title. Returns the top teams; use team_outlook for one team's detail.",
    input_schema: {
      type: "object",
      properties: { vbClass: classParam, topN: { type: "integer", description: "how many teams to return (default 20)" } },
      required: ["vbClass"],
    },
  },
  {
    name: "team_outlook",
    description:
      "Everything about one team: record, wildcard average, rating, projected seed and group, probabilities of each postseason outcome, most likely opponents at each stage with probabilities, most likely host sites, and remaining regular-season matches.",
    input_schema: {
      type: "object",
      properties: { vbClass: classParam, team: { type: "string", description: "Team name as NSAA prints it, e.g. 'Gering'" } },
      required: ["vbClass", "team"],
    },
  },
  {
    name: "head_to_head",
    description:
      "Win probability between two teams (any class) for a best-of-5 match, with optional host, plus any meetings between them this season.",
    input_schema: {
      type: "object",
      properties: {
        teamA: { type: "string" },
        teamB: { type: "string" },
        host: { type: "string", description: "teamA, teamB, or 'neutral' (default neutral)" },
      },
      required: ["teamA", "teamB"],
    },
  },
  {
    name: "get_team_schedule",
    description: "A team's full season schedule and results with wildcard points per match.",
    input_schema: { type: "object", properties: { team: { type: "string" } }, required: ["team"] },
  },
  {
    name: "fetch_nsaa_bracket",
    description:
      "Fetch the live NSAA bracket page for a district/sub-district (published Thursday Oct 22 for 2026). Returns site, times and any results NSAA has posted. Pass a group id like 'B-6' or 'C2-7'.",
    input_schema: { type: "object", properties: { groupId: { type: "string" } }, required: ["groupId"] },
  },
  {
    name: "fetch_district_finals",
    description: "Fetch NSAA's live District Finals page (C1/C2/D1/D2): date, host site, teams and winners once known.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "distance_between",
    description: "Approximate driving miles between two schools or neutral sites (used for host/neutral-site rules).",
    input_schema: { type: "object", properties: { a: { type: "string" }, b: { type: "string" } }, required: ["a", "b"] },
  },
  {
    name: "get_rules",
    description: "Summary of the 2026 NSAA postseason rules: wildcard formula, district formation, hosting, qualification, dates, tiebreakers.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
];

const pct = (n: number, d: number) => Math.round((1000 * n) / d) / 10;

function top<T extends Record<string, number>>(o: T, k = 5) {
  return Object.entries(o)
    .sort((a, b) => b[1] - a[1])
    .slice(0, k);
}

function findTeam(names: Iterable<string>, q: string): string | undefined {
  const list = [...names];
  const lq = q.trim().toLowerCase();
  return (
    list.find((n) => n.toLowerCase() === lq) ??
    list.find((n) => n.toLowerCase().startsWith(lq)) ??
    list.find((n) => n.toLowerCase().includes(lq))
  );
}

function groupIdToDistId(groupId: string): number | undefined {
  const m = groupId.toUpperCase().match(/^([ABCD][12]?)-(\d{1,2})$/);
  if (!m) return undefined;
  const [, cls, n] = m;
  const i = Number(n) - 1;
  const table: Record<string, number[]> = {
    A: [2, 3, 4, 5, 6, 7, 87],
    B: [8, 9, 10, 11, 12, 13, 88],
    C1: [38, 39, 40, 41, 42, 43, 44, 45, 46, 47],
    C2: [50, 51, 52, 53, 54, 55, 56, 57, 58, 59],
    D1: [62, 63, 64, 65, 66, 67, 68, 69, 70, 71, 72, 73],
    D2: [74, 75, 76, 77, 78, 79, 80, 81, 82, 83, 84, 85],
  };
  return table[cls]?.[i];
}

export async function runTool(name: string, input: Json): Promise<Json> {
  const season = await loadSeason();
  const { data } = season;
  const allNames = new Set<string>([...data.teams.keys(), ...data.matches.map((m) => m.opponent)]);

  switch (name) {
    case "get_standings": {
      const vbClass = input.vbClass as VbClass;
      const proj = await getProjection(vbClass);
      const groupOf = new Map<string, { group: string; seed: number }>();
      for (const g of proj.groups) for (const t of g.teams) groupOf.set(t.name, { group: g.id, seed: t.seed });
      return {
        vbClass,
        seedingCutoff: SEEDING_CUTOFF,
        dataAsOf: season.fetchedAt.toISOString(),
        standings: proj.overall.map((t) => ({
          seed: t.seed,
          team: t.name,
          record: `${t.wins}-${t.losses}`,
          wildcardAvg: Number(t.avg.toFixed(4)),
          rating: Number((data.ratings.rating.get(t.name) ?? 0).toFixed(2)),
          ...groupOf.get(t.name),
        })),
      };
    }
    case "get_projected_brackets": {
      const vbClass = input.vbClass as VbClass;
      const proj = await getProjection(vbClass);
      const want = (input.groupId as string | undefined)?.toUpperCase();
      const brackets = proj.brackets.filter((b) => !want || b.id === want);
      return {
        vbClass,
        note:
          vbClass === "B"
            ? "District finals (Oct 31) are hosted by the highest remaining seed; earlier rounds move to a neutral site (McCook, Lexington, Hastings, GI Northwest) if the two schools are > 300 miles apart."
            : "The #1 seed hosts sub-district semifinals and the final. In 5/6-team sub-districts the higher seed hosts the #4v#5 / #3v#6 match if it is closer than traveling to the #1 seed. Sub-district winners + 6 best remaining averages go to the Oct 31 district finals, hosted by the higher seed.",
        brackets: brackets.map((b) => ({
          id: b.id,
          teams: b.teams.map((t) => ({ seed: t.seed, team: t.name, record: `${t.wins}-${t.losses}`, avg: Number(t.avg.toFixed(4)) })),
          matches: b.matches.map((m) => ({
            label: m.label,
            date: m.date,
            top: m.top,
            bottom: m.bottom,
            host: m.host ?? (m.site ? `neutral: ${m.site}` : "highest remaining seed"),
          })),
        })),
      };
    }
    case "simulate_postseason": {
      const vbClass = input.vbClass as VbClass;
      const topN = Number(input.topN ?? 20);
      const sim = await getSimulation(vbClass);
      const n = sim.nSims;
      const rows = Object.values(sim.teams)
        .map((t) => summarize(t, n, vbClass))
        .sort((a, b) => (b.pReachState as number) - (a.pReachState as number))
        .slice(0, topN);
      return { vbClass, nSims: n, seedingCutoff: sim.cutoff, homeAdvantageSetLogit: sim.ratingSummary.home, teams: rows };
    }
    case "team_outlook": {
      const vbClass = input.vbClass as VbClass;
      const team = findTeam([...data.teams.keys()].filter((t) => data.teams.get(t) === vbClass), String(input.team));
      if (!team) return { error: `No ${vbClass} team matching '${input.team}'` };
      const sim = await getSimulation(vbClass);
      const t = sim.teams[team];
      const n = sim.nSims;
      const proj = await getProjection(vbClass);
      const group = proj.groups.find((g) => g.teams.some((x) => x.name === team))!;
      const rec = computeRecord(team, vbClass, data.matches, { throughDate: SEEDING_CUTOFF });
      const stageKeys: Stage[] = ["group-r1", "group-semi", "group-final", "district-final", "state-quarter", "state-semi", "state-final"];
      const opponents = Object.fromEntries(
        stageKeys.map((s) => [
          s,
          top(t.opponents[s], 6).map(([opp, c]) => ({ opponent: opp, probability: pct(c, n) })),
        ]),
      );
      const sites = Object.fromEntries(
        stageKeys.map((s) => [s, top(t.sites[s], 4).map(([site, c]) => ({ site, probability: pct(c, n) }))]),
      );
      const remaining = data.matches.filter((m) => m.team === team && !m.played).map((m) => ({ date: m.date, opponent: m.opponent, away: m.away }));
      return {
        team,
        vbClass,
        record: `${rec.wins}-${rec.losses}`,
        wildcardAvg: Number(rec.avg.toFixed(4)),
        rating: Number((data.ratings.rating.get(team) ?? 0).toFixed(2)),
        projectedOverallSeed: proj.overall.find((x) => x.name === team)?.seed,
        projectedGroup: group.id,
        projectedGroupSeed: group.teams.find((x) => x.name === team)?.seed,
        groupMates: group.teams.map((x) => `${x.seed}. ${x.name} (${x.wins}-${x.losses}, ${x.avg.toFixed(2)})`),
        probabilities: summarize(t, n, vbClass),
        overallSeedDistribution: top(t.overallSeed, 5).map(([s, c]) => ({ seed: Number(s), probability: pct(c, n) })),
        groupDistribution: top(t.group, 4).map(([g, c]) => ({ group: g, probability: pct(c, n) })),
        stateSeedDistribution: top(t.stateSeed, 4).map(([s, c]) => ({ seed: Number(s), probability: pct(c, n) })),
        likelyOpponentsByStage: opponents,
        likelySitesByStage: sites,
        remainingRegularSeason: remaining,
      };
    }
    case "head_to_head": {
      const a = findTeam(allNames, String(input.teamA));
      const b = findTeam(allNames, String(input.teamB));
      if (!a || !b) return { error: `Unknown team: ${!a ? input.teamA : input.teamB}` };
      const hostRaw = String(input.host ?? "neutral").toLowerCase();
      const home = hostRaw === "neutral" ? 0 : findTeam([a], hostRaw) ? 1 : findTeam([b], hostRaw) ? -1 : 0;
      const p = setWinProb(data.ratings, a, b, home);
      const meetings = data.matches
        .filter((m) => m.played && ((m.team === a && m.opponent === b) || (m.team === b && m.opponent === a)))
        .filter((m, i, arr) => arr.findIndex((x) => x.date === m.date) === i)
        .map((m) => ({ date: m.date, winner: m.won ? m.team : m.opponent, score: `${m.setsFor}-${m.setsAgainst}` }));
      return {
        teamA: a,
        teamB: b,
        host: home === 1 ? a : home === -1 ? b : "neutral",
        ratingA: Number((data.ratings.rating.get(a) ?? 0).toFixed(2)),
        ratingB: Number((data.ratings.rating.get(b) ?? 0).toFixed(2)),
        pSetA: Number(p.toFixed(3)),
        pMatchA_bestOf5: Number(matchWinProb(p, 5).toFixed(3)),
        pMatchA_bestOf3: Number(matchWinProb(p, 3).toFixed(3)),
        meetingsThisSeason: meetings,
      };
    }
    case "get_team_schedule": {
      const team = findTeam(data.teams.keys(), String(input.team));
      if (!team) return { error: `Unknown team ${input.team}` };
      const rec = computeRecord(team, data.teams.get(team)!, data.matches);
      return {
        team,
        vbClass: data.teams.get(team),
        record: `${rec.wins}-${rec.losses}`,
        wildcardAvg: Number(rec.avg.toFixed(4)),
        matches: data.matches
          .filter((m) => m.team === team)
          .map((m) => ({
            date: m.date,
            opponent: m.opponent,
            oppClass: m.opponentClass,
            oppRecord: `${m.opponentWins}-${m.opponentLosses}`,
            away: m.away,
            result: m.played ? `${m.won ? "W" : "L"} ${m.setsFor}-${m.setsAgainst}` : "unplayed",
            points: m.points,
            tournament: m.tournament,
          })),
      };
    }
    case "fetch_nsaa_bracket": {
      const distId = groupIdToDistId(String(input.groupId));
      if (!distId) return { error: `Unknown group id ${input.groupId}` };
      const url = NSAA_URLS.bracket(distId);
      const html = await (await fetch(url, { cache: "no-store" })).text();
      const parsed = parseBracketPage(html);
      return { url, available: parsed.available, title: parsed.title, results: parsed.results, text: parsed.text.slice(0, 4000) };
    }
    case "fetch_district_finals": {
      const html = await (await fetch(NSAA_URLS.districtFinals, { cache: "no-store" })).text();
      return { url: NSAA_URLS.districtFinals, finals: parseDistrictFinals(html).filter((f) => f.id.startsWith("C2") || f.id.startsWith("C1")) };
    }
    case "distance_between": {
      const a = findTeam(data.geo.keys(), String(input.a));
      const b = findTeam(data.geo.keys(), String(input.b));
      if (!a || !b) return { error: `No coordinates for ${!a ? input.a : input.b}` };
      return { a, b, miles: Math.round(distanceMiles(data.geo, a, b) ?? 0) };
    }
    case "get_rules":
      return { rules: RULES_SUMMARY };
    default:
      return { error: `Unknown tool ${name}` };
  }
}

function summarize(t: TeamSimStats, n: number, vbClass: VbClass): Json {
  const isC = vbClass.startsWith("C");
  return {
    team: t.name,
    pWinGroup: pct(t.wonGroup, n),
    ...(isC ? { pReachDistrictFinal: pct(t.reachedDistrictFinal, n) } : { pWildcard: pct(t.wildcard, n) }),
    pReachState: pct(t.reachedState, n),
    pStateSemifinal: pct(t.wonStateQuarter, n),
    pStateFinal: pct(t.wonStateSemi, n),
    pChampion: pct(t.champion, n),
    mostLikelyGroup: top(t.group, 1)[0]?.[0],
  };
}
