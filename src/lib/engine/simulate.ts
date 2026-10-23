/**
 * Monte Carlo simulation of the NSAA postseason for one class.
 *
 * Per simulation:
 *   1. draw ratings (point estimate + estimation noise)
 *   2. simulate remaining regular-season matches through the seeding cutoff
 *   3. compute wildcard records → form districts / sub-districts
 *   4. simulate those brackets (host rules applied)
 *   5. (C1/C2/D1/D2) recompute averages → sub-district winners + best non-winners → 16-team district finals
 *      (A/B)         7 district winners + best remaining average = wildcard
 *   6. recompute averages → 8-team state bracket → simulate
 *   7. tally everything
 */
import type { Bracket, BracketMatch, Match, MatchResult, OfficialClass, SeededTeam, TeamRecord, VbClass } from "./types";
import { computeRecord, rankByWildcard } from "./wildcard";
import {
  applyOfficial,
  completeOfficialGroups,
  expectedGroupCount,
  officialDistrictFinalsBracket,
  siteHost,
} from "./official";
import {
  DIST_IDS,
  formAssignedSubdistricts,
  formRegionSubdistricts,
  formSerpentineDistricts,
  type Group,
  type RegionAssignment,
  type SubdistrictAssignment,
} from "./seeding";
import {
  buildDistrictBracket,
  buildDistrictFinals,
  buildStateBracket,
  buildSubdistrictBracket,
  DATES_2026,
  groupDates,
  hasDistrictFinals,
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
  /** NSAA-assigned sub-districts (D1/D2). */
  subdistricts: Partial<Record<VbClass, SubdistrictAssignment[]>>;
  /** Official pairings and results from NSAA's bracket and district-finals pages, once posted. */
  official: Partial<Record<VbClass, OfficialClass>>;
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
  /**
   * What-if picks: bracket match id ("B-1-M3", "C2-DF4", "B-ST-F") → the team that wins it if it plays in it. Posted
   * results always win over a pick; a pick for a team that doesn't reach the match is ignored in that run.
   */
  picks?: Record<string, string>;
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
  reachedDistrictFinal: number; // C1/C2/D1/D2
  wildcard: number; // A/B: qualified as the wildcard
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
  /** Bracket match id → winner → runs won (district / sub-district, district final and state matches). */
  matchWins: Record<string, Record<string, number>>;
  picks: Record<string, string>;
}

export interface Projection {
  overall: SeededTeam[];
  groups: Group[];
  brackets: Bracket[];
  /** Groups, seeds and pairings are NSAA's official ones (all of the class's bracket pages are posted). */
  official: boolean;
  /** C1/C2/D1/D2 district finals as NSAA posted them, with results (absent until all 8 pairings are up). */
  districtFinals?: Bracket;
}

export interface ProjectOptions {
  /** Ignore official pairings — the rule-based projection, for comparing against NSAA's. */
  computedOnly?: boolean;
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
 * Deterministic view: current records through cutoff, no simulation. Official groups, pairings and results once
 * NSAA has posted them, otherwise the rule-based projection.
 */
export function project(data: SeasonData, vbClass: VbClass, cutoff: string, opts: ProjectOptions = {}): Projection {
  const names = [...data.teams].filter(([, c]) => c === vbClass).map(([n]) => n);
  const live = baseRecords(data);
  const records = names.map((n) => computeRecord(n, vbClass, data.matches, { throughDate: cutoff, liveRecords: live }));
  const proj = formGroupsAndBrackets(data, vbClass, records, () => 0.5, opts);
  if (opts.computedOnly) return proj;
  const recordOf = (n: string) =>
    records.find((r) => r.name === n) ?? computeRecord(n, vbClass, data.matches, { throughDate: cutoff, liveRecords: live });
  const df = officialDistrictFinalsBracket(vbClass, data.official[vbClass]?.districtFinals, recordOf);
  return df ? { ...proj, districtFinals: df } : proj;
}

function formGroupsAndBrackets(
  data: SeasonData,
  vbClass: VbClass,
  records: TeamRecord[],
  rng: () => number,
  opts: ProjectOptions = {},
): Projection {
  const official = opts.computedOnly
    ? null
    : completeOfficialGroups(
        data.official[vbClass]?.groups,
        vbClass,
        expectedGroupCount(vbClass, data.subdistricts[vbClass]?.length),
      );
  const serpentine = vbClass === "A" || vbClass === "B";
  const build = (g: Group) => (serpentine ? buildDistrictBracket(g, data.geo) : buildSubdistrictBracket(g, data.geo));
  if (official) {
    // NSAA's groups and seeds; our builders give the bracket shape the simulation knows, NSAA's page the details.
    const byName = new Map(records.map((r) => [r.name, r]));
    const overall = rankByWildcard(records, data.matches, rng).map((r, i) => ({ ...r, seed: i + 1 }));
    const groups: Group[] = official.map((og, i) => ({
      id: og.id,
      name: `${serpentine ? "District" : "Sub-district"} ${og.id}`,
      vbClass,
      distId: DIST_IDS[vbClass][i],
      teams: og.seeds.flatMap((s) => {
        const r = byName.get(s.name);
        return r ? [{ ...r, seed: s.seed }] : [];
      }),
    }));
    return { overall, groups, brackets: groups.map((g, i) => applyOfficial(build(g), official[i])), official: true };
  }
  if (serpentine) {
    const { overall, groups } = formSerpentineDistricts(vbClass, records, data.matches, rng);
    return { overall, groups, brackets: groups.map(build), official: false };
  }
  const formed =
    vbClass === "C1" || vbClass === "C2"
      ? formRegionSubdistricts(vbClass, required(data.regions[vbClass], `region assignments for ${vbClass}`), records, data.matches, rng)
      : formAssignedSubdistricts(vbClass, required(data.subdistricts[vbClass], `sub-district assignments for ${vbClass}`), records, data.matches, rng);
  return { ...formed, brackets: formed.groups.map(build), official: false };
}

function required<T>(v: T | undefined, what: string): T {
  if (!v) throw new Error(`No ${what} — run \`npm run scrape\` or refresh the snapshots`);
  return v;
}

export function runSimulation(data: SeasonData, cfg: SimConfig): SimResult {
  const rng = makeRng(cfg.seed ?? 20261020);
  const names = [...data.teams].filter(([, c]) => c === cfg.vbClass).map(([n]) => n);
  const stats: Record<string, TeamSimStats> = Object.fromEntries(names.map((n) => [n, emptyStats(n)]));
  const picks = cfg.picks ?? {};
  const matchWins: Record<string, Record<string, number>> = {};
  /** Posted result, else a what-if pick for one of these two teams, else nothing (simulate it). */
  const decide = (m: BracketMatch, a: string, b: string): MatchResult | undefined => {
    const posted = fixedFor(m, a, b);
    if (posted) return posted;
    const p = picks[m.id];
    return p === a || p === b ? { winner: p, loser: p === a ? b : a } : undefined;
  };
  const won = (m: BracketMatch, w: string) => inc((matchWins[m.id] ??= {}), w);
  const canon = canonicalize(data.matches);
  const remaining = canon.filter((m) => !m.played && m.date <= cfg.cutoff);
  const base = baseRecords(data);
  const withDistrictFinals = hasDistrictFinals(cfg.vbClass);
  const groupFinalDate = groupDates(cfg.vbClass).final;
  const officialDF = withDistrictFinals
    ? officialDistrictFinalsBracket(cfg.vbClass, data.official[cfg.vbClass]?.districtFinals, (n) =>
        computeRecord(n, cfg.vbClass, data.matches),
      )
    : null;
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
    const play: PlayFn = (a, b, homeA, bestOf, date, hostOf, fixed) => {
      // A result NSAA has posted is the same in every run; it still counts toward later seeding averages.
      const [w, l] = [fixed?.setsW ?? 3, fixed?.setsL ?? 0];
      const [sa, sb] = fixed ? (fixed.winner === a ? [w, l] : [l, w]) : simulateMatch(setP(a, b, homeA), bestOf, rng);
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
      const winner = simulateBracket(br, { data, play, stats, decide, won }, (m, isFinal) =>
        isFinal ? "group-final" : /#4 vs #5|#3 vs #6/.test(m.label) ? "group-r1" : "group-semi",
      );
      groupWinners.set(br.id, winner);
      stats[winner].wonGroup++;
    }

    // 5. district finals / wildcard
    let stateField: string[];
    let stateRecordsDate: string;
    if (withDistrictFinals && officialDF) {
      // NSAA has posted the district-final pairings: play exactly those, with any results already in.
      stateField = [];
      for (const m of officialDF.matches) {
        const [a, b] = [m.top!, m.bottom!];
        for (const t of [a, b]) if (stats[t]) stats[t].reachedDistrictFinal++;
        const homeA = m.host === a ? 1 : m.host === b ? -1 : 0;
        const w = play(a, b, homeA, 5, m.date ?? DATES_2026.districtFinal, m.host ?? null, decide(m, a, b));
        tallyMatch(stats, "district-final", a, b, m.officialSite ?? m.host ?? "TBD");
        won(m, w);
        stateField.push(w);
      }
      stateRecordsDate = DATES_2026.districtFinal;
    } else if (withDistrictFinals) {
      // Sub-district winners + the best non-winners fill 16 spots (C1/C2: 10 + 6, D1/D2: 12 + 4).
      const after = recordsThrough(groupFinalDate);
      const winners = new Set(groupWinners.values());
      const atLarge = 16 - winners.size;
      const nonWinners = rankByWildcard(after.filter((r) => !winners.has(r.name)), data.matches, rng).slice(0, atLarge);
      const field = rankByWildcard(after.filter((r) => winners.has(r.name) || nonWinners.some((x) => x.name === r.name)), data.matches, rng);
      const seeded: SeededTeam[] = field.map((r, i) => ({ ...r, seed: i + 1 }));
      for (const t of seeded) stats[t.name].reachedDistrictFinal++;
      const df = buildDistrictFinals(cfg.vbClass, seeded);
      stateField = [];
      for (const m of df.matches) {
        if (!m.top || !m.bottom) continue;
        const w = play(m.top, m.bottom, 1, 5, m.date ?? DATES_2026.districtFinal, m.host ?? null, decide(m, m.top, m.bottom));
        tallyMatch(stats, "district-final", m.top, m.bottom, m.host ?? m.site ?? "TBD");
        won(m, w);
        stateField.push(w);
      }
      stateRecordsDate = DATES_2026.districtFinal;
    } else {
      const after = recordsThrough(groupFinalDate);
      const winners = new Set(groupWinners.values());
      const wc = rankByWildcard(after.filter((r) => !winners.has(r.name)), data.matches, rng)[0];
      stats[wc.name].wildcard++;
      stateField = [...winners, wc.name];
      stateRecordsDate = groupFinalDate;
    }

    // 6. state
    const stateRecs = recordsThrough(stateRecordsDate).filter((r) => stateField.includes(r.name));
    const stateSeeded: SeededTeam[] = rankByWildcard(stateRecs, data.matches, rng).map((r, i) => ({ ...r, seed: i + 1 }));
    for (const t of stateSeeded) {
      stats[t.name].reachedState++;
      inc(stats[t.name].stateSeed, t.seed);
    }
    const st = buildStateBracket(cfg.vbClass, stateSeeded);
    const champ = simulateBracket(st, { data, play, stats, decide, won }, (m) =>
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
    matchWins,
    picks,
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

type PlayFn = (
  a: string,
  b: string,
  homeA: number,
  bestOf: 3 | 5,
  date: string,
  hostOf: string | null,
  fixed?: MatchResult,
) => string;

/** The match's posted result, if it was between exactly these two teams. */
function fixedFor(m: BracketMatch, a: string, b: string): MatchResult | undefined {
  const r = m.result;
  return r && ((r.winner === a && r.loser === b) || (r.winner === b && r.loser === a)) ? r : undefined;
}

/**
 * Resolve "W:<matchId>" references and play a bracket in round order.
 * Returns the winner of the last match. Hosts: NSAA's listed venue when posted; otherwise the rules — Class A/B
 * finals at the highest remaining seed, Class B neutral site if > 300 miles. Posted results and what-if picks are fixed.
 */
interface BracketContext {
  data: SeasonData;
  play: PlayFn;
  stats: Record<string, TeamSimStats>;
  /** Posted result or what-if pick for this match between these teams, if any. */
  decide: (m: BracketMatch, a: string, b: string) => MatchResult | undefined;
  /** Tally the match's winner. */
  won: (m: BracketMatch, winner: string) => void;
}

function simulateBracket(
  br: Bracket,
  { data, play, stats, decide, won }: BracketContext,
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
    if (m.officialSite) {
      host = siteHost(m.officialSite, a, b);
      site = host ? undefined : m.officialSite;
    } else if (!host && !site) {
      // Class A/B district final: highest remaining seed hosts (Class B: regardless of distance).
      host = seedOf(a) <= seedOf(b) ? a : b;
    } else if (br.vbClass === "B" && m.round < lastRound && host) {
      const d = distanceMiles(data.geo, a, b);
      if (d !== undefined && d > CLASS_B_NEUTRAL_MILES) {
        site = nearestNeutral(data.geo, a, b);
        host = undefined;
      }
    }
    const homeA = host === a ? 1 : host === b ? -1 : 0;
    const w = play(a, b, homeA, 5, m.date ?? "2026-10-31", host ?? null, decide(m, a, b));
    winners.set(m.id, w);
    won(m, w);
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
