/**
 * Bracket construction for sub-districts, Class B districts, district finals
 * and the state tournament — per the 2026 NSAA Volleyball Manual.
 */
import type { Bracket, BracketMatch, SeededTeam, VbClass } from "./types";
import type { Group } from "./seeding";
import { distanceMiles, type Geo } from "./geo";

export const DATES_2026 = {
  classA: { r1: "2026-10-26", r2: "2026-10-27", final: "2026-10-28" },
  classB: { r1: "2026-10-27", r2: "2026-10-29", final: "2026-10-31" },
  classC: { r1: "2026-10-26", r2: "2026-10-27", final: "2026-10-28" },
  // D1/D2 sub-districts are two days (4–5 teams), so day 2 is also the last day.
  classD: { r1: "2026-10-26", r2: "2026-10-27", final: "2026-10-27" },
  districtFinal: "2026-10-31",
  state: {
    // 26schedule.pdf: A, B, C1 open Wed Nov 4; C2, D1, D2 open Thu Nov 5.
    quarter: { A: "2026-11-04", B: "2026-11-04", C1: "2026-11-04", C2: "2026-11-05", D1: "2026-11-05", D2: "2026-11-05" } as Record<
      VbClass,
      string
    >,
    semi: "2026-11-06",
    final: "2026-11-07",
  },
};

/** Day-by-day dates of a class's district / sub-district round. */
export function groupDates(vbClass: VbClass) {
  if (vbClass === "A") return DATES_2026.classA;
  if (vbClass === "B") return DATES_2026.classB;
  if (vbClass === "C1" || vbClass === "C2") return DATES_2026.classC;
  return DATES_2026.classD;
}

/** C1/C2/D1/D2 send sub-district winners + at-large teams to 16-team district finals; A/B go straight to state. */
export const hasDistrictFinals = (vbClass: VbClass) => vbClass !== "A" && vbClass !== "B";

export const CLASS_B_NEUTRAL_SITES = ["McCook", "Lexington", "Hastings", "Grand Island Northwest"];
export const CLASS_B_NEUTRAL_MILES = 300;

const W = (id: string) => `W:${id}`;

function team(group: Group, seed: number): SeededTeam | undefined {
  return group.teams.find((t) => t.seed === seed);
}

/**
 * Sub-district (C1/C2/D1/D2) bracket for 4, 5 or 6 teams.
 *  4: D1 M1 #1v#4, M2 #3v#2 (at #1) ; D2 final
 *  5: D1 M1 #4v#5, M2 #3v#2, M3 #1 v W(M1) ; D2 final
 *  6: D1 M1 #4v#5, M2 #3v#6 ; D2 M3 #1 v W1, M4 #2 v W2 ; D3 final
 * Host: #1 seed hosts semis/final. C1/C2 only: in 5/6-team sub-districts the higher seed of
 * #4v#5 and #3v#6 hosts if the distance between them is closer than to #1. D1/D2: the #1 seed hosts everything.
 */
export function buildSubdistrictBracket(group: Group, geo: Geo): Bracket {
  const n = group.teams.length;
  const one = team(group, 1)!;
  const d = groupDates(group.vbClass);
  const m: BracketMatch[] = [];
  const id = (k: number) => `${group.id}-M${k}`;

  const playInHost = (hi: SeededTeam, lo: SeededTeam) => {
    if (group.vbClass === "D1" || group.vbClass === "D2") return one.name;
    const dHiLo = distanceMiles(geo, hi.name, lo.name);
    const dHiOne = distanceMiles(geo, hi.name, one.name);
    if (dHiLo !== undefined && dHiOne !== undefined && dHiLo < dHiOne) return hi.name;
    return one.name;
  };

  if (n <= 4) {
    const t1 = one, t2 = team(group, 2)!, t3 = team(group, 3)!, t4 = team(group, 4);
    m.push({ id: id(1), round: 1, label: "#1 vs #4", top: t1.name, bottom: t4?.name ?? null, host: one.name, date: d.r1 });
    m.push({ id: id(2), round: 1, label: "#2 vs #3", top: t2.name, bottom: t3.name, host: one.name, date: d.r1 });
    m.push({ id: id(3), round: 2, label: "Final", top: W(id(1)), bottom: W(id(2)), host: one.name, date: d.r2 });
  } else if (n === 5) {
    const t2 = team(group, 2)!, t3 = team(group, 3)!, t4 = team(group, 4)!, t5 = team(group, 5)!;
    m.push({ id: id(1), round: 1, label: "#4 vs #5", top: t4.name, bottom: t5.name, host: playInHost(t4, t5), date: d.r1 });
    m.push({ id: id(2), round: 1, label: "#2 vs #3", top: t2.name, bottom: t3.name, host: one.name, date: d.r1 });
    m.push({ id: id(3), round: 1, label: "#1 vs W(4/5)", top: one.name, bottom: W(id(1)), host: one.name, date: d.r1 });
    m.push({ id: id(4), round: 2, label: "Final", top: W(id(3)), bottom: W(id(2)), host: one.name, date: d.r2 });
  } else {
    const t2 = team(group, 2)!, t3 = team(group, 3)!, t4 = team(group, 4)!, t5 = team(group, 5)!, t6 = team(group, 6)!;
    m.push({ id: id(1), round: 1, label: "#4 vs #5", top: t4.name, bottom: t5.name, host: playInHost(t4, t5), date: d.r1 });
    m.push({ id: id(2), round: 1, label: "#3 vs #6", top: t3.name, bottom: t6.name, host: playInHost(t3, t6), date: d.r1 });
    m.push({ id: id(3), round: 2, label: "#1 vs W(4/5)", top: one.name, bottom: W(id(1)), host: one.name, date: d.r2 });
    m.push({ id: id(4), round: 2, label: "#2 vs W(3/6)", top: t2.name, bottom: W(id(2)), host: one.name, date: d.r2 });
    m.push({ id: id(5), round: 3, label: "Final", top: W(id(3)), bottom: W(id(4)), host: one.name, date: d.final });
  }
  return { id: group.id, name: group.name, vbClass: group.vbClass, teams: group.teams, matches: m };
}

/**
 * Class A/B district bracket (4 or 5 teams). Dates are A / B:
 *  5: r1 (Oct 26 / 27) #4 hosts #5 ; r2 (Oct 27 / 29) #1 hosts W(4/5), #2 hosts #3 ; final (Oct 28 / 31) at highest remaining seed
 *  4: r2 #1 hosts #4, #2 hosts #3 ; final at highest remaining seed
 * Class B only: neutral site if two schools are > 300 miles apart before the final.
 * Host for the final is resolved at simulation time (depends on who advances).
 */
export function buildDistrictBracket(group: Group, geo: Geo): Bracket {
  const n = group.teams.length;
  const d = groupDates(group.vbClass);
  const m: BracketMatch[] = [];
  const id = (k: number) => `${group.id}-M${k}`;
  const t = (s: number) => team(group, s)!;

  const hostFor = (hi: SeededTeam, lo: SeededTeam): { host?: string; site?: string } => {
    const dist = distanceMiles(geo, hi.name, lo.name);
    if (group.vbClass === "B" && dist !== undefined && dist > CLASS_B_NEUTRAL_MILES) {
      return { host: undefined, site: nearestNeutral(geo, hi.name, lo.name) };
    }
    return { host: hi.name };
  };

  if (n === 5) {
    m.push({ id: id(1), round: 1, label: "#4 vs #5", top: t(4).name, bottom: t(5).name, ...hostFor(t(4), t(5)), date: d.r1 });
    m.push({ id: id(2), round: 2, label: "#1 vs W(4/5)", top: t(1).name, bottom: W(id(1)), host: t(1).name, date: d.r2 });
    m.push({ id: id(3), round: 2, label: "#2 vs #3", top: t(2).name, bottom: t(3).name, ...hostFor(t(2), t(3)), date: d.r2 });
    m.push({ id: id(4), round: 3, label: "District Final", top: W(id(2)), bottom: W(id(3)), date: d.final });
  } else {
    m.push({ id: id(1), round: 2, label: "#1 vs #4", top: t(1).name, bottom: t(4).name, ...hostFor(t(1), t(4)), date: d.r2 });
    m.push({ id: id(2), round: 2, label: "#2 vs #3", top: t(2).name, bottom: t(3).name, ...hostFor(t(2), t(3)), date: d.r2 });
    m.push({ id: id(3), round: 3, label: "District Final", top: W(id(1)), bottom: W(id(2)), date: d.final });
  }
  return { id: group.id, name: group.name, vbClass: group.vbClass, teams: group.teams, matches: m };
}

export function nearestNeutral(geo: Geo, a: string, b: string): string {
  let best = CLASS_B_NEUTRAL_SITES[0];
  let bestD = Infinity;
  for (const s of CLASS_B_NEUTRAL_SITES) {
    const da = distanceMiles(geo, a, s) ?? 0;
    const db = distanceMiles(geo, b, s) ?? 0;
    const worst = Math.max(da, db);
    if (worst < bestD) {
      bestD = worst;
      best = s;
    }
  }
  return best;
}

/** 16-team district final pairings: 1v16, 2v15, … 8v9. Higher seed hosts. */
export function buildDistrictFinals(vbClass: VbClass, seeded: SeededTeam[]): Bracket {
  const m: BracketMatch[] = [];
  for (let i = 0; i < 8; i++) {
    const hi = seeded[i];
    const lo = seeded[15 - i];
    m.push({
      id: `${vbClass}-DF${i + 1}`,
      round: 1,
      label: `District Final ${vbClass}-${i + 1}`,
      top: hi?.name ?? null,
      bottom: lo?.name ?? null,
      host: hi?.name,
      date: DATES_2026.districtFinal,
    });
  }
  return { id: `${vbClass}-DF`, name: `Class ${vbClass} District Finals`, vbClass, teams: seeded, matches: m };
}

/** 8-team state bracket: G1 1v8, G2 4v5, G3 2v7, G4 3v6; semis G1/G2 and G3/G4. */
export function buildStateBracket(vbClass: VbClass, seeded: SeededTeam[]): Bracket {
  const s = (n: number) => seeded[n - 1]?.name ?? null;
  const d = DATES_2026.state;
  const q = d.quarter[vbClass];
  const id = (k: string) => `${vbClass}-ST-${k}`;
  const m: BracketMatch[] = [
    { id: id("Q1"), round: 1, label: "Quarterfinal 1 (#1 vs #8)", top: s(1), bottom: s(8), site: "Lincoln", date: q },
    { id: id("Q2"), round: 1, label: "Quarterfinal 2 (#4 vs #5)", top: s(4), bottom: s(5), site: "Lincoln", date: q },
    { id: id("Q3"), round: 1, label: "Quarterfinal 3 (#2 vs #7)", top: s(2), bottom: s(7), site: "Lincoln", date: q },
    { id: id("Q4"), round: 1, label: "Quarterfinal 4 (#3 vs #6)", top: s(3), bottom: s(6), site: "Lincoln", date: q },
    { id: id("S1"), round: 2, label: "Semifinal 1", top: W(id("Q1")), bottom: W(id("Q2")), site: "Lincoln", date: d.semi },
    { id: id("S2"), round: 2, label: "Semifinal 2", top: W(id("Q3")), bottom: W(id("Q4")), site: "Lincoln", date: d.semi },
    { id: id("F"), round: 3, label: "State Championship", top: W(id("S1")), bottom: W(id("S2")), site: "Lincoln", date: d.final },
  ];
  return { id: `${vbClass}-STATE`, name: `Class ${vbClass} State Championship`, vbClass, teams: seeded, matches: m };
}
