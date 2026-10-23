/**
 * What-if picks on a bracket (shared by the simulator page and its tests). A pick names the winner of one match; the
 * simulation treats it like a posted result. Who plays in a later match follows from posted results and picks.
 */
import type { Bracket, BracketMatch } from "./types";

export type Picks = Record<string, string>;

/** The team a slot holds: a team name, or the posted / picked winner of the match it refers to ("W:B-1-M1"). */
export function slotTeam(br: Bracket, ref: string | null, picks: Picks): string | null {
  if (!ref?.startsWith("W:")) return ref;
  const m = br.matches.find((x) => x.id === ref.slice(2));
  return m ? matchWinner(br, m, picks) : null;
}

/** The two teams of a match as far as they're known (null = not decided yet). */
export function matchTeams(br: Bracket, m: BracketMatch, picks: Picks): [string | null, string | null] {
  return [slotTeam(br, m.top, picks), slotTeam(br, m.bottom, picks)];
}

/** Posted winner, else the pick if that team is in the match, else unknown. A bye goes to the team that's there. */
export function matchWinner(br: Bracket, m: BracketMatch, picks: Picks): string | null {
  if (m.result) return m.result.winner;
  const [a, b] = matchTeams(br, m, picks);
  if (a && !m.bottom) return a;
  const p = picks[m.id];
  return p && (p === a || p === b) ? p : null;
}

/**
 * Drop picks that can't happen any more: a match with a posted result, or a team that no longer reaches the match
 * (after an earlier pick changed). Returns the same object when nothing changed.
 */
export function prunePicks(brackets: Bracket[], picks: Picks): Picks {
  const out: Picks = { ...picks };
  for (const br of brackets) {
    for (const m of [...br.matches].sort((x, y) => x.round - y.round)) {
      if (!(m.id in out)) continue;
      const [a, b] = matchTeams(br, m, out);
      if (m.result || (out[m.id] !== a && out[m.id] !== b)) delete out[m.id];
    }
  }
  return Object.keys(out).length === Object.keys(picks).length ? picks : out;
}
