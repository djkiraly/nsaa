/**
 * NSAA Wildcard point system (2026 Volleyball Manual, "Wildcard System").
 *
 *            1st Div   2nd Div   3rd Div   4th Div
 *  Win         50        47        44        41
 *  Loss        39        36        33        30
 *
 *  + Class A vs Class A: +2
 *  + Opponent 1 class above: +2, 2 above: +3, 3 above: +4, 4 above: +5
 *  No deduction for playing down.
 *
 *  Average = total points / matches played (all varsity matches, in- and out-of-state).
 */
import {
  CLASS_ORDER,
  type Division,
  type Match,
  type TeamRecord,
  type VbClass,
} from "./types";

const WIN_PTS: Record<Division, number> = { 1: 50, 2: 47, 3: 44, 4: 41 };
const LOSS_PTS: Record<Division, number> = { 1: 39, 2: 36, 3: 33, 4: 30 };

/**
 * Division from a win/loss record. A 0-0 record (an out-of-state school whose
 * record was never reported) counts as 4th division, per the manual.
 */
export function divisionFor(wins: number, losses: number): Division {
  const n = wins + losses;
  if (n === 0) return 4;
  const pct = wins / n;
  if (pct >= 0.75) return 1;
  if (pct >= 0.5) return 2;
  if (pct >= 0.25) return 3;
  return 4;
}

export function classBonus(teamClass: VbClass, oppClass: VbClass): number {
  const ti = CLASS_ORDER.indexOf(teamClass);
  const oi = CLASS_ORDER.indexOf(oppClass);
  if (teamClass === "A" && oppClass === "A") return 2;
  const up = ti - oi; // positive when opponent is in a higher (bigger) class
  if (up <= 0) return 0;
  return Math.min(up + 1, 5); // 1 up → 2, 2 up → 3, 3 up → 4, 4+ up → 5
}

export function matchPoints(
  teamClass: VbClass,
  oppClass: VbClass,
  oppDivision: Division,
  won: boolean,
): number {
  const base = won ? WIN_PTS[oppDivision] : LOSS_PTS[oppDivision];
  return base + classBonus(teamClass, oppClass);
}

export interface RecordOptions {
  /** Only count matches on or before this ISO date (inclusive). */
  throughDate?: string;
  /**
   * Live records of every team (for recomputing opponent divisions after
   * simulated results). If omitted, the opponent record stored on each match
   * row is used — this reproduces NSAA's published numbers exactly.
   */
  liveRecords?: Map<string, { wins: number; losses: number }>;
}

/**
 * Compute a team's wildcard record from its match rows.
 * Unplayed matches are ignored.
 */
export function computeRecord(
  name: string,
  vbClass: VbClass,
  matches: Match[],
  opts: RecordOptions = {},
): TeamRecord {
  let wins = 0,
    losses = 0,
    points = 0,
    firstDiv = 0,
    oppW = 0,
    oppL = 0;
  for (const m of matches) {
    if (m.team !== name || !m.played || m.won === undefined) continue;
    if (opts.throughDate && m.date > opts.throughDate) continue;
    const live = opts.liveRecords?.get(m.opponent);
    const ow = live ? live.wins : m.opponentWins;
    const ol = live ? live.losses : m.opponentLosses;
    const div = divisionFor(ow, ol);
    const pts = matchPoints(vbClass, m.opponentClass, div, m.won);
    points += pts;
    if (m.won) wins++;
    else losses++;
    // Tiebreaker count. Class A only counts first-division teams "in their classification" (Manual, tiebreaker C).
    if (div === 1 && (vbClass !== "A" || m.opponentClass === "A")) firstDiv++;
    oppW += ow;
    oppL += ol;
  }
  const n = wins + losses;
  return {
    name,
    vbClass,
    wins,
    losses,
    points,
    avg: n ? points / n : 0,
    firstDivOpponents: firstDiv,
    oppWins: oppW,
    oppLosses: oppL,
  };
}

/** Build records for every team in a class. */
export function computeClassRecords(
  vbClass: VbClass,
  teams: string[],
  matches: Match[],
  opts: RecordOptions = {},
): TeamRecord[] {
  return teams.map((t) => computeRecord(t, vbClass, matches, opts));
}

/**
 * Head-to-head results between two teams: returns +1 if a has the majority of
 * wins vs b, -1 if b does, 0 if even / never played.
 */
export function headToHead(a: string, b: string, matches: Match[]): number {
  let aw = 0,
    bw = 0;
  for (const m of matches) {
    if (!m.played || m.won === undefined) continue;
    if (m.team === a && m.opponent === b) m.won ? aw++ : bw++;
  }
  if (aw === bw) return 0;
  return aw > bw ? 1 : -1;
}

/**
 * Sort records by wildcard seeding rules (Manual, "Seedings and Pairings" §3):
 *  1. higher average
 *  2. (two-way tie) head-to-head
 *  3. more first-division opponents
 *  4. opponents' winning percentage
 *  5. coin flip → we use a stable deterministic fallback (name) and flag it.
 */
export function rankByWildcard<T extends TeamRecord>(
  records: T[],
  matches: Match[],
  rng: () => number = Math.random,
): T[] {
  const EPS = 1e-9;
  const sorted = [...records].sort((a, b) => b.avg - a.avg);
  // Resolve ties group by group.
  const out: T[] = [];
  let i = 0;
  while (i < sorted.length) {
    let j = i + 1;
    while (j < sorted.length && Math.abs(sorted[j].avg - sorted[i].avg) < EPS) j++;
    const group = sorted.slice(i, j);
    if (group.length === 1) out.push(group[0]);
    else out.push(...breakTies(group, matches, rng));
    i = j;
  }
  return out;
}

function breakTies<T extends TeamRecord>(group: T[], matches: Match[], rng: () => number): T[] {
  if (group.length === 2) {
    const h = headToHead(group[0].name, group[1].name, matches);
    if (h !== 0) return h > 0 ? [group[0], group[1]] : [group[1], group[0]];
  }
  const oppPct = (r: TeamRecord) =>
    r.oppWins + r.oppLosses ? r.oppWins / (r.oppWins + r.oppLosses) : 0;
  return [...group].sort((a, b) => {
    if (a.firstDivOpponents !== b.firstDivOpponents)
      return b.firstDivOpponents - a.firstDivOpponents;
    const d = oppPct(b) - oppPct(a);
    if (Math.abs(d) > 1e-12) return d;
    return rng() < 0.5 ? -1 : 1; // coin flip
  });
}
