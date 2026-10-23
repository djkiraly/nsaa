/**
 * Core domain types for the NSAA volleyball postseason engine.
 *
 * Everything here is pure data — no I/O. The engine modules operate on these
 * and are unit-tested against NSAA's published numbers.
 */

export type VbClass = "A" | "B" | "C1" | "C2" | "D1" | "D2";
export const CLASS_ORDER: VbClass[] = ["A", "B", "C1", "C2", "D1", "D2"];

/** 1 = won ≥75%, 2 = ≥50%, 3 = ≥25%, 4 = <25% */
export type Division = 1 | 2 | 3 | 4;

export interface Team {
  /** Canonical display name as NSAA prints it, e.g. "Gering", "North Platte St. Patrick's" */
  name: string;
  /** NSAA class this team competes in. Out-of-state teams carry the class NSAA assigned them. */
  vbClass: VbClass;
  /** NSAA school id when known (from schedule links). */
  sid?: number;
  /** True for non-Nebraska schools (appear with ", WY"/", CO" etc. suffix). */
  outOfState?: boolean;
}

export interface Match {
  /** ISO date YYYY-MM-DD */
  date: string;
  /** Team whose schedule this row came from. */
  team: string;
  /** Opponent canonical name. */
  opponent: string;
  opponentClass: VbClass;
  /** Opponent's season record as NSAA listed it at scrape time. */
  opponentWins: number;
  opponentLosses: number;
  opponentDivision: Division;
  /** True if `team` was the visitor (NSAA prefixes opponent with "@"). */
  away: boolean;
  /** Whether this match has been played. */
  played: boolean;
  won?: boolean;
  /** Sets won by team / by opponent */
  setsFor?: number;
  setsAgainst?: number;
  /** NSAA wildcard points awarded for this match (0/undefined if unplayed). */
  points?: number;
  tournament?: string;
  tournamentLocation?: string;
}

export interface TeamRecord {
  name: string;
  vbClass: VbClass;
  wins: number;
  losses: number;
  /** Total wildcard points across played matches */
  points: number;
  /** Wildcard average = points / matches played */
  avg: number;
  /** Number of first-division opponents faced (tiebreaker criterion; Class A counts only Class A opponents) */
  firstDivOpponents: number;
  /** Opponents' aggregate W-L (tiebreaker criterion) */
  oppWins: number;
  oppLosses: number;
}

export interface SeededTeam extends TeamRecord {
  seed: number;
}

/** A result NSAA has posted. Sets are the winner's and the loser's (absent if NSAA showed only who advanced). */
export interface MatchResult {
  winner: string;
  loser: string;
  setsW?: number;
  setsL?: number;
}

/** A single bracket match slot. */
export interface BracketMatch {
  id: string;
  round: number;
  label: string;
  /** Team names or references to other match winners (prefixed "W:") */
  top: string | null;
  bottom: string | null;
  /** Host team name, or a neutral site name. */
  host?: string;
  site?: string;
  date?: string;
  winner?: string;
  /** From NSAA's official bracket page, once posted. */
  time?: string;
  /** Venue NSAA lists for the match ("Waverly"); decides home court over the rule-based host. */
  officialSite?: string;
  result?: MatchResult;
}

/** One game on an NSAA bracket page (names already matched to the schedule export). */
export interface OfficialGame {
  num: number;
  date?: string;
  time?: string;
  site?: string;
  /** Top and bottom slots; `seeded` marks a team's first appearance ("#2 Northwest …") vs. an advancing winner. */
  slots: ({ name: string; seeded: boolean } | null)[];
  winner?: string;
  /** Winner's sets – loser's sets */
  score?: [number, number];
  /** Game number the winner moves on to (card layout); absent for the final. */
  feeds?: number;
}

/** An official district / sub-district from NSAA's bracket page. */
export interface OfficialGroup {
  id: string;
  defaultSite?: string;
  seeds: { name: string; seed: number }[];
  games: OfficialGame[];
}

/** One C1/C2/D1/D2 district final from NSAA's district finals page. */
export interface OfficialDistrictFinal {
  id: string;
  date?: string;
  time?: string;
  host?: string;
  teams?: { name: string; seed: number }[];
  winner?: string;
  score?: [number, number];
}

export interface OfficialClass {
  groups: Record<string, OfficialGroup>;
  districtFinals: Record<string, OfficialDistrictFinal>;
}

export interface Bracket {
  id: string;
  name: string;
  vbClass: VbClass;
  teams: SeededTeam[];
  matches: BracketMatch[];
}

export interface School {
  name: string;
  city: string;
  lat: number;
  lon: number;
}
