/**
 * Monte Carlo simulation of the NSAA postseason for one class.
 *
 * Per simulation:
 *   1. draw ratings (point estimate + estimation noise)
 *   2. simulate remaining regular-season matches through the seeding cutoff
 *   3. compute wildcard records → form districts / sub-districts
 *   4. simulate those brackets (host rules applied)
 *   5. (C1/C2) recompute averages → 16-team district finals → simulate
 *      (B)     7 district winners + best remaining average = wildcard
 *   6. recompute averages → 8-team state bracket → simulate
 *   7. tally everything
 */
import type { Bracket, BracketMatch, Match, SeededTeam, TeamRecord, VbClass } from "./types";
import { computeRecord, rankByWildcard } from "./wildcard";
import {
  formClassBDistricts,
  formRegionSubdistricts,
  type Group,
  type RegionAssignment,
} from "./seeding";
import {
  buildClassBDistrictBracket,
  buildDistrictFinals,
  buildStateBracket,
  buildSubdistrictBracket,
  DATES_2026,
  nearestNeutral,
  CLASS_B_NEUTRAL_MILES,
} from "./brackets";
import { distanceMiles, type Geo } from "./geo";
import {
  canonicalize,
  gaussian,
  makeRng,
  setWinProb,
  simulateMatch,
  type CanonicalMatch,
  type Ratings,
} from "./ratings";

export interface SeasonData {
  /** Every schedule row from every class export. */
  matches: Match[];
  /** Team → class for every team that has its own schedule in the exports. */
  teams: Map<string, VbClass>;
  /** Region assignments (C1/C2). */
  regions: Partial<Record<VbClass, RegionAssignment[]>>;
  geo: Geo;
  ratings: Ratings;
}

export interface SimConfig {
  vbClass: VbClass;
  /** Seeding cutoff — matches through this date count (2026: Oct 20). */
  cutoff: string;
  nSims: number;
  seed?: number;
  ratingNoise?: boolean;
}

export type Stage =
  | "group-r1"
  | "group-semi"
  | "group-final"
  | "district-final"
  | "state-quarter"
  | "state-semi"
  | "state-final";

export interface TeamSimStats {
  name: string;
  sims: number;
  overallSeed: Record<number, number>;
  group: Record<string, number>;
  groupSeed: Record<string, number>; // "C2-7#1"
  wonGroup: number;
  reachedDistrictFinal: number; // C classes
  wildcard: number; // B: qualified as the wildcard
  reachedState: number;
  stateSeed: Record<number, number>;
  wonStateQuarter: number;
  wonStateSemi: number;
  champion: number;
  /** stage → opponent → count */
  opponents: Record<Stage, Record<string, number>>;
  /** stage → host/site → count */
  sites: Record<Stage, Record<string, number>>;
}

export interface SimResult {
  vbClass: VbClass;
  nSims: number;
  cutoff: string;
  teams: Record<string, TeamSimStats>;
  /** Deterministic projection from current data (unplayed matches ignored). */
  projection: Projection;
  ratingSummary: { home: number };
}

export interface Projection {
  overall: SeededTeam[];
  groups: Group[];
  brackets: Bracket[];
}

interface SimResultRow {
  date: string;
  winner: string;
  loser: string;
  setsW: number;
  setsL: number;
  hostOf: string | null; // which team hosted, or null for neutral
}

const STAGES: Stage[] = [
  "group-r1",
  "group-semi",
  "group-final",
  "district-final",
  "state-quarter",
  "state-semi",
  "state-final",
];

function emptyStats(name: string): TeamSimStats {
  const stageRec = () => Object.fromEntries(STAGES.map((s) => [s, {}])) as Record<Stage, Record<string, number>>;
  return {
    name,
    sims: 0,
    overallSeed: {},
    group: {},
    groupSeed: {},
    wonGroup: 0,
    reachedDistrictFinal: 0,
    wildcard: 0,
    reachedState: 0,
    stateSeed: {},
    wonStateQuarter: 0,
    wonStateSemi: 0,
    champion: 0,
    opponents: stageRec(),
    sites: stageRec(),
  };
}

const inc = (o: Record<string | number, number>, k: string | number) => {
  o[k] = (o[k] ?? 0) + 1;
};

/** Base W/L for every team name that appears anywhere. */
export function baseRecords(data: SeasonData): Map<string, { wins: number; losses: number }> {
  const rec = new Map<string, { wins: number; losses: number }>();
  // Teams with schedules: compute from their rows.
  for (const m of data.matches) {
    if (!m.played || m.won === undefined) continue;
    const r = rec.get(m.team) ?? { wins: 0, losses: 0 };
    if (m.won) r.wins++;
    else r.losses++;
    rec.set(m.team, r);
  }
  // Everyone else (out-of-state): take NSAA's listed record.
  for (const m of data.matches) {
    if (!rec.has(m.opponent)) rec.set(m.opponent, { wins: m.opponentWins, losses: m.opponentLosses });
  }
  return rec;
}

function classOf(data: SeasonData, name: string, fallbackRows: Match[]): VbClass {
  const c = data.teams.get(name);
  if (c) return c;
  const row = fallbackRows.find((m) => m.opponent === name);
  return row?.opponentClass ?? "D2";
}

/**
 * Deterministic projection: current records through cutoff, no simulation.
 */
export function project(data: SeasonData, vbClass: VbClass, cutoff: string): Projection {
  const names = [...data.teams].filter(([, c]) => c === vbClass).map(([n]) => n);
  const live = baseRecords(data);
  const records = names.map((n) => computeRecord(n, vbClass, data.matches, { throughDate: cutoff, liveRecords: live }));
  return formGroupsAndBrackets(data, vbClass, records, () => 0.5);
}

function formGroupsAndBrackets(
  data: SeasonData,
  vbClass: VbClass,
  records: TeamRecord[],
  rng: () => number,
): Projection {
  if (vbClass === "B") {
    const { overall, groups } = formClassBDistricts(records, data.matches, rng);
    return { overall, groups, brackets: groups.map((g) => buildClassBDistrictBracket(g, data.geo)) };
  }
  if (vbClass === "C1" || vbClass === "C2") {
    const regions = data.regions[vbClass];
    if (!regions) throw new Error(`No region assignments for ${vbClass}`);
    const { overall, groups } = formRegionSubdistricts(vbClass, regions, records, data.matches, rng);
    return { overall, groups, brackets: groups.map((g) => buildSubdistrictBracket(g, data.geo)) };
  }
  throw new Error(`Class ${vbClass} not supported yet`);
}

export function runSimulation(data: SeasonData, cfg: SimConfig): SimResult {
  const rng = makeRng(cfg.seed ?? 20261020);
  const names = [...data.teams].filter(([, c]) => c === cfg.vbClass).map(([n]) => n);
  const stats: Record<string, TeamSimStats> = Object.fromEntries(names.map((n) => [n, emptyStats(n)]));
  const canon = canonicalize(data.matches);
  const remaining = canon.filter((m) => !m.played && m.date <= cfg.cutoff);
  const base = baseRecords(data);
  const isC = cfg.vbClass === "C1" || cfg.vbClass === "C2";
  const rowsByTeam = new Map<string, Match[]>();
  for (const m of data.matches) {
    if (!rowsByTeam.has(m.team)) rowsByTeam.set(m.team, []);
    rowsByTeam.get(m.team)!.push(m);
  }
  const oppClassCache = new Map<string, VbClass>();
  const oppClass = (n: string) => {
    let c = oppClassCache.get(n);
    if (!c) {
      c = classOf(data, n, data.matches);
      oppClassCache.set(n, c);
    }
    return c;
  };

  for (let s = 0; s < cfg.nSims; s++) {
    // 1. ratings draw
    const override = new Map<string, number>();
    if (cfg.ratingNoise !== false) {
      for (const [t, r] of data.ratings.rating) override.set(t, r + (data.ratings.se.get(t) ?? 0.5) * gaussian(rng));
    }
    const setP = (a: string, b: string, home: number) => setWinProb(data.ratings, a, b, home, override);

    // 2. remaining regular season
    const simRows: SimResultRow[] = [];
    const live = new Map(base); // shallow copy; we replace entries on update
    const bump = (team: string, won: boolean) => {
      const r = live.get(team) ?? { wins: 0, losses: 0 };
      live.set(team, { wins: r.wins + (won ? 1 : 0), losses: r.losses + (won ? 0 : 1) });
    };
    const play = (a: string, b: string, homeA: number, bestOf: 3 | 5, date: string, hostOf: string | null) => {
      const [sa, sb] = simulateMatch(setP(a, b, homeA), bestOf, rng);
      const aWon = sa > sb;
      simRows.push({ date, winner: aWon ? a : b, loser: aWon ? b : a, setsW: Math.max(sa, sb), setsL: Math.min(sa, sb), hostOf });
      bump(a, aWon);
      bump(b, !aWon);
      return aWon ? a : b;
    };
    for (const m of remaining) play(m.a, m.b, m.homeA, m.bestOf, m.date, m.homeA === 1 ? m.a : m.homeA === -1 ? m.b : null);

    const rowsFor = (team: string): Match[] => {
      const extra: Match[] = simRows
        .filter((r) => r.winner === team || r.loser === team)
        .map((r) => {
          const opp = r.winner === team ? r.loser : r.winner;
          const won = r.winner === team;
          const lr = live.get(opp) ?? { wins: 0, losses: 0 };
          return {
            date: r.date,
            team,
            opponent: opp,
            opponentClass: oppClass(opp),
            opponentWins: lr.wins,
            opponentLosses: lr.losses,
            opponentDivision: 2,
            away: r.hostOf !== null && r.hostOf !== team,
            played: true,
            won,
            setsFor: won ? r.setsW : r.setsL,
            setsAgainst: won ? r.setsL : r.setsW,
          };
        });
      return [...(rowsByTeam.get(team) ?? []), ...extra];
    };
    const recordsThrough = (date: string): TeamRecord[] =>
      names.map((n) => computeRecord(n, cfg.vbClass, rowsFor(n), { throughDate: date, liveRecords: live }));

    // 3. seeding & groups
    const proj = formGroupsAndBrackets(data, cfg.vbClass, recordsThrough(cfg.cutoff), rng);
    for (const t of proj.overall) inc(stats[t.name].overallSeed, t.seed);
    for (const g of proj.groups) {
      for (const t of g.teams) {
        inc(stats[t.name].group, g.id);
        inc(stats[t.name].groupSeed, `${g.id}#${t.seed}`);
      }
    }

    // 4. group brackets
    const groupWinners = new Map<string, string>();
    for (const br of proj.brackets) {
      const winner = simulateBracket(br, data, play, stats, (m, isFinal) =>
        isFinal ? "group-final" : /#4 vs #5|#3 vs #6/.test(m.label) ? "group-r1" : "group-semi",
      );
      groupWinners.set(br.id, winner);
      stats[winner].wonGroup++;
    }

    // 5. district finals / wildcard
    let stateField: string[];
    let stateRecordsDate: string;
    if (isC) {
      const after = recordsThrough(DATES_2026.classC.final);
      const winners = new Set(groupWinners.values());
      const nonWinners = rankByWildcard(after.filter((r) => !winners.has(r.name)), data.matches, rng).slice(0, 6);
      const field = rankByWildcard(after.filter((r) => winners.has(r.name) || nonWinners.some((x) => x.name === r.name)), data.matches, rng);
      const seeded: SeededTeam[] = field.map((r, i) => ({ ...r, seed: i + 1 }));
      for (const t of seeded) stats[t.name].reachedDistrictFinal++;
      const df = buildDistrictFinals(cfg.vbClass, seeded);
      stateField = [];
      for (const m of df.matches) {
        if (!m.top || !m.bottom) continue;
        const w = play(m.top, m.bottom, 1, 5, m.date ?? DATES_2026.districtFinal, m.host ?? null);
        tallyMatch(stats, "district-final", m.top, m.bottom, m.host ?? m.site ?? "TBD");
        stateField.push(w);
      }
      stateRecordsDate = DATES_2026.districtFinal;
    } else {
      const after = recordsThrough(DATES_2026.classB.final);
      const winners = new Set(groupWinners.values());
      const wc = rankByWildcard(after.filter((r) => !winners.has(r.name)), data.matches, rng)[0];
      stats[wc.name].wildcard++;
      stateField = [...winners, wc.name];
      stateRecordsDate = DATES_2026.classB.final;
    }

    // 6. state
    const stateRecs = recordsThrough(stateRecordsDate).filter((r) => stateField.includes(r.name));
    const stateSeeded: SeededTeam[] = rankByWildcard(stateRecs, data.matches, rng).map((r, i) => ({ ...r, seed: i + 1 }));
    for (const t of stateSeeded) {
      stats[t.name].reachedState++;
      inc(stats[t.name].stateSeed, t.seed);
    }
    const st = buildStateBracket(cfg.vbClass, stateSeeded);
    const champ = simulateBracket(st, data, play, stats, (m) =>
      m.round === 1 ? "state-quarter" : m.round === 2 ? "state-semi" : "state-final",
    );
    stats[champ].champion++;
    for (const n of names) stats[n].sims++;
  }

  return {
    vbClass: cfg.vbClass,
    nSims: cfg.nSims,
    cutoff: cfg.cutoff,
    teams: stats,
    projection: project(data, cfg.vbClass, cfg.cutoff),
    ratingSummary: { home: data.ratings.home },
  };
}

function tallyMatch(stats: Record<string, TeamSimStats>, stage: Stage, a: string, b: string, site: string) {
  if (stats[a]) {
    inc(stats[a].opponents[stage], b);
    inc(stats[a].sites[stage], site);
  }
  if (stats[b]) {
    inc(stats[b].opponents[stage], a);
    inc(stats[b].sites[stage], site);
  }
}

type PlayFn = (a: string, b: string, homeA: number, bestOf: 3 | 5, date: string, hostOf: string | null) => string;

/**
 * Resolve "W:<matchId>" references and play a bracket in round order.
 * Returns the winner of the last match. Host for Class B finals is resolved
 * here (highest remaining seed; neutral site if > 300 miles).
 */
function simulateBracket(
  br: Bracket,
  data: SeasonData,
  play: PlayFn,
  stats: Record<string, TeamSimStats>,
  stageOf: (m: BracketMatch, isFinal: boolean) => Stage,
): string {
  const winners = new Map<string, string>();
  const seedOf = (n: string) => br.teams.find((t) => t.name === n)?.seed ?? 99;
  const lastRound = Math.max(...br.matches.map((m) => m.round));
  const resolve = (ref: string | null) => (ref && ref.startsWith("W:") ? winners.get(ref.slice(2)) ?? null : ref);
  let last = "";
  const ordered = [...br.matches].sort((x, y) => x.round - y.round);
  for (const m of ordered) {
    const a = resolve(m.top);
    const b = resolve(m.bottom);
    if (!a && !b) continue;
    if (!a || !b) {
      // bye
      const w = (a ?? b)!;
      winners.set(m.id, w);
      last = w;
      continue;
    }
    let host = m.host;
    let site = m.site;
    if (!host && !site) {
      // Class B district final: highest remaining seed hosts regardless of distance.
      host = seedOf(a) <= seedOf(b) ? a : b;
    } else if (br.vbClass === "B" && m.round < lastRound && host) {
      const d = distanceMiles(data.geo, a, b);
      if (d !== undefined && d > CLASS_B_NEUTRAL_MILES) {
        site = nearestNeutral(data.geo, a, b);
        host = undefined;
      }
    }
    const homeA = host === a ? 1 : host === b ? -1 : 0;
    const w = play(a, b, homeA, 5, m.date ?? "2026-10-31", host ?? null);
    winners.set(m.id, w);
    const stage = stageOf(m, m.round === lastRound);
    tallyMatch(stats, stage, a, b, host ?? site ?? "TBD");
    if (stats[w]) {
      if (stage === "state-quarter") stats[w].wonStateQuarter++;
      if (stage === "state-semi") stats[w].wonStateSemi++;
    }
    last = w;
  }
  return last;
}

export { canonicalize };
export type { CanonicalMatch, BracketMatch };
