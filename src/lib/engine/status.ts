/**
 * Where each team stands once results come in: still alive, hanging on for an at-large spot / the wildcard, out, or
 * through to state.
 *
 * A loss ends a season at state and in a C1/C2/D1/D2 district final. A loss in a district / sub-district doesn't:
 * A/B take the best remaining average as the wildcard, C1/C2/D1/D2 the best six / four remaining averages into the
 * district finals. Those teams are out only once that's decided — by posted results (the wildcard is known when every
 * district final is in; the district-final field when NSAA posts it, or when every sub-district is done) — and
 * "likely out" while no simulation run gets them in but it isn't settled yet.
 */
import { hasDistrictFinals } from "./brackets";
import { matchWinner } from "./picks";
import type { Projection } from "./simulate";
import type { Bracket, BracketMatch, VbClass } from "./types";

export type StatusKind = "champion" | "qualified" | "alive" | "at-large" | "likely-out" | "eliminated";

export type Stage = "district" | "district-final" | "state";

export interface Loss {
  opponent: string;
  /** "3-1" when NSAA posted the score */
  score?: string;
  stage: Stage;
  /** Bracket name and match, e.g. "District B-1 · #4 vs #5" */
  where: string;
  date?: string;
}

export interface TeamStatus {
  kind: StatusKind;
  /** The loss that ended (or threatens) the season, if any. */
  loss?: Loss;
  /** The title that got the team here, e.g. "District B-1", "Sub-district C2-4" or "District Final C1-3". */
  won?: string;
  /** Chance of still reaching state — for alive / at-large / likely-out teams. */
  pState?: number;
  /** One line for people: "Lost to Alliance 3-0 · District B-1, Oct 27 — out of wildcard contention". */
  summary: string;
}

/** Simulation odds a status needs, as fractions of runs. */
export interface StatusOdds {
  reachedState: number;
  reachedDistrictFinal: number;
  wildcard: number;
}

const STAGE_LABEL: Record<Stage, string> = { district: "district", "district-final": "district final", state: "state" };

function lossesIn(br: Bracket | undefined, stage: Stage): Map<string, Loss> {
  const out = new Map<string, Loss>();
  for (const m of br?.matches ?? []) {
    const r = m.result;
    if (!r) continue;
    out.set(r.loser, {
      opponent: r.winner,
      score: r.setsW !== undefined ? `${r.setsW}-${r.setsL}` : undefined,
      stage,
      where: `${br!.name} · ${m.label}`,
      date: m.date,
    });
  }
  return out;
}

const shortDate = (iso?: string) =>
  iso ? new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }) : "";

export function lossText(l: Loss): string {
  return `Lost to ${l.opponent}${l.score ? ` ${l.score}` : ""} · ${l.where}${l.date ? `, ${shortDate(l.date)}` : ""}`;
}

const pct = (p: number) => (p > 0 && p < 0.01 ? "<1%" : `${Math.round(p * 100)}%`);

export function teamStatuses(
  vbClass: VbClass,
  proj: Projection,
  odds: (team: string) => StatusOdds,
): Map<string, TeamStatus> {
  const withDF = hasDistrictFinals(vbClass);
  const groupLoss = new Map<string, Loss>();
  for (const b of proj.brackets) for (const [t, l] of lossesIn(b, "district")) groupLoss.set(t, l);
  const dfLoss = lossesIn(proj.districtFinals, "district-final");
  const stateLoss = lossesIn(proj.state, "state");
  const finalOf = (b: Bracket) => b.matches.at(-1) as BracketMatch;
  const champion = proj.state ? matchWinner(proj.state, finalOf(proj.state), {}) : null;
  const stateField = new Set(proj.state?.teams.map((t) => t.name) ?? []);
  const dfField = new Set(proj.districtFinals?.teams.map((t) => t.name) ?? []);
  const groupWinner = new Map(proj.brackets.map((b) => [matchWinner(b, finalOf(b), {}), b.name] as const));
  groupWinner.delete(null);
  const groupsDone = groupWinner.size === proj.brackets.length;
  const dfWinner = new Map(
    (proj.districtFinals?.matches ?? []).filter((m) => m.result).map((m) => [m.result!.winner, m.label.replace(/\s*\(.*\)$/, "")] as const),
  );
  const groupWord = withDF ? "sub-district" : "district";

  const out = new Map<string, TeamStatus>();
  for (const { name } of proj.overall) {
    const o = odds(name);
    const st = (s: TeamStatus) => out.set(name, s);
    if (champion === name) {
      st({ kind: "champion", summary: "State champion" });
      continue;
    }
    const lost = stateLoss.get(name) ?? dfLoss.get(name);
    if (lost) {
      st({ kind: "eliminated", loss: lost, summary: `${lossText(lost)} — season over` });
      continue;
    }
    if (stateField.has(name)) {
      const w = withDF ? dfWinner.get(name) : groupWinner.get(name);
      st({
        kind: "qualified",
        won: w,
        summary: proj.wildcard === name ? "Qualified for state (wildcard)" : w ? `Won ${w} — qualified for state` : "Qualified for state",
      });
      continue;
    }
    const gl = groupLoss.get(name);
    if (gl) {
      const route = withDF ? "an at-large district-final spot" : "the wildcard";
      // Settled: the wildcard is known (A/B), or the district-final field is (C/D: posted, or every sub-district done
      // and no run takes this team — a run that does means a tie on averages still open).
      const settled = withDF ? dfField.size > 0 || (groupsDone && o.reachedDistrictFinal === 0) : proj.wildcard !== undefined;
      const inDF = withDF && dfField.has(name);
      if (inDF || (withDF && groupsDone && o.reachedDistrictFinal >= 1)) {
        st({ kind: "alive", loss: gl, pState: o.reachedState, summary: `${lossText(gl)} — in the district final as an at-large team` });
      } else if (!withDF && proj.wildcard === name) {
        st({ kind: "qualified", loss: gl, summary: "Qualified for state (wildcard)" });
      } else if (settled) {
        st({ kind: "eliminated", loss: gl, summary: `${lossText(gl)} — missed ${route}` });
      } else if (o.reachedState > 0) {
        st({ kind: "at-large", loss: gl, pState: o.reachedState, summary: `${lossText(gl)} — alive for ${route} (${pct(o.reachedState)} to reach state)` });
      } else {
        st({ kind: "likely-out", loss: gl, pState: 0, summary: `${lossText(gl)} — no path to state in any simulation; waiting on other ${groupWord}s` });
      }
      continue;
    }
    // Qualified only by results: an A/B district title or a C/D district final — never just by the odds.
    const won = withDF ? dfWinner.get(name) : groupWinner.get(name);
    if (won) {
      st({ kind: "qualified", won, summary: `Won ${won} — qualified for state` });
      continue;
    }
    const sub = withDF ? groupWinner.get(name) : undefined;
    const oddsText = o.reachedState >= 1 ? ">99%" : pct(o.reachedState);
    st({ kind: "alive", won: sub, pState: o.reachedState, summary: `${sub ? `Won ${sub} — in the district final` : "Alive"} · ${oddsText} to reach state` });
  }
  return out;
}

/** Human label for a stage, for grouping eliminated teams. */
export const stageLabel = (s: Stage) => STAGE_LABEL[s];
