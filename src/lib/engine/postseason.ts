/**
 * Postseason results from every source NSAA posts them in, looked up by the two teams and the date.
 *
 *  - The schedule export lists district / sub-district / district-final matches like any other (tournament
 *    "District B-1", "Subdistrict C2-4"), so they're already in each team's rows and records. The simulation must
 *    not count them a second time.
 *  - The bracket pages and the state page show results that may not be in the export (state never is).
 */
import type { Bracket, BracketMatch, Match, MatchResult } from "./types";

export interface PostedGame extends MatchResult {
  date: string;
  /** Already a played row in the schedule export (counted in records). */
  inExport: boolean;
}

/** Export rows from postseason events. */
export const isPostseasonEvent = (tournament: string | undefined) =>
  !!tournament && /^(district|sub-?district|state)\b/i.test(tournament.trim());

/** One game per postseason match in the export (both teams list it; the first row wins). */
export function exportPostseasonGames(matches: Match[]): PostedGame[] {
  const seen = new Set<string>();
  const out: PostedGame[] = [];
  for (const m of matches) {
    if (!m.played || m.won === undefined || !isPostseasonEvent(m.tournament)) continue;
    const k = `${m.date}|${pairKey(m.team, m.opponent)}`;
    if (seen.has(k)) continue;
    seen.add(k);
    const [winner, loser] = m.won ? [m.team, m.opponent] : [m.opponent, m.team];
    const [w, l] = m.won ? [m.setsFor, m.setsAgainst] : [m.setsAgainst, m.setsFor];
    out.push({ date: m.date, winner, loser, setsW: w, setsL: l, inExport: true });
  }
  return out;
}

const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

const DAY = 86_400_000;
const days = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) / DAY;

/** Posted games by pair; a match finds the game on its date, or the nearest within a few days (moved matches). */
export class PostedResults {
  private byPair = new Map<string, PostedGame[]>();
  constructor(games: PostedGame[]) {
    for (const g of games) {
      const k = pairKey(g.winner, g.loser);
      const list = this.byPair.get(k) ?? [];
      // The export and a bracket page can both have a game; keep the export's (it's counted in records).
      const dup = list.findIndex((x) => x.date === g.date);
      if (dup === -1) list.push(g);
      else if (g.inExport && !list[dup].inExport) list[dup] = g;
      this.byPair.set(k, list);
    }
  }
  find(a: string, b: string, date: string | undefined, withinDays = 3): PostedGame | undefined {
    const list = this.byPair.get(pairKey(a, b));
    if (!list?.length) return undefined;
    if (!date) return list.length === 1 ? list[0] : undefined;
    return list
      .filter((g) => days(g.date, date) <= withinDays)
      .sort((x, y) => days(x.date, date) - days(y.date, date))[0];
  }
  get size() {
    return [...this.byPair.values()].reduce((s, l) => s + l.length, 0);
  }
}

/**
 * Add results from `posted` to a bracket's matches that don't have one, in round order, so a later match whose
 * teams depend on earlier results can be filled too.
 */
export function fillResults(br: Bracket, posted: PostedResults): Bracket {
  const matches: BracketMatch[] = br.matches.map((m) => ({ ...m }));
  const byId = new Map(matches.map((m) => [m.id, m]));
  const team = (ref: string | null): string | null =>
    ref?.startsWith("W:") ? (byId.get(ref.slice(2))?.result?.winner ?? null) : ref;
  for (const m of [...matches].sort((x, y) => x.round - y.round)) {
    if (m.result) continue;
    const [a, b] = [team(m.top), team(m.bottom)];
    if (!a || !b) continue;
    const g = posted.find(a, b, m.date);
    if (g) m.result = { winner: g.winner, loser: g.loser, setsW: g.setsW, setsL: g.setsL };
  }
  return { ...br, matches };
}
