/**
 * Official NSAA pairings and results layered onto the engine.
 *
 * Once NSAA posts every bracket page for a class (Thursday Oct 22), its groups and seeds replace the projected
 * ones; brackets are still built by our builders (same structure the simulation knows) and then annotated with
 * NSAA's dates, times, venues and posted results. Posted results are fixed in every simulation run, and they feed
 * the averages used for later seeding.
 */
import type {
  Bracket,
  BracketMatch,
  MatchResult,
  OfficialDistrictFinal,
  OfficialGroup,
  TeamRecord,
  VbClass,
} from "./types";
import type { Group } from "./seeding";

/** How many groups each class has (D1/D2: the NSAA assignment page, normally 12). */
export function expectedGroupCount(vbClass: VbClass, assigned?: number): number {
  if (vbClass === "A" || vbClass === "B") return 7;
  if (vbClass === "C1" || vbClass === "C2") return 10;
  return assigned ?? 12;
}

/** The class's official groups in order, but only once all of them are posted (otherwise null → keep projecting). */
export function completeOfficialGroups(
  groups: Record<string, OfficialGroup> | undefined,
  vbClass: VbClass,
  count: number,
): OfficialGroup[] | null {
  if (!groups) return null;
  const out: OfficialGroup[] = [];
  for (let i = 1; i <= count; i++) {
    const g = groups[`${vbClass}-${i}`];
    if (!g || g.seeds.length < 2) return null;
    out.push(g);
  }
  return out;
}

const words = (s: string) =>
  s
    .toLowerCase()
    .replace(/\([^)]*\)/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);

/**
 * Which of two teams a listed venue belongs to ("@ Duchesne" → "Omaha Duchesne Academy"), or undefined for a
 * neutral site. Exact name first, then all of one name's words appearing in the other.
 */
export function siteHost(site: string | undefined, a: string, b: string): string | undefined {
  if (!site) return undefined;
  const s = words(site);
  const exact = [a, b].find((t) => words(t).join(" ") === s.join(" "));
  if (exact) return exact;
  const contains = (x: string[], y: string[]) => x.length > 0 && x.every((w) => y.includes(w));
  const hits = [a, b].filter((t) => contains(s, words(t)) || contains(words(t), s));
  return hits.length === 1 ? hits[0] : undefined;
}

/** Fill a bracket's matches with NSAA's dates, times, venues and results. */
export function applyOfficial(br: Bracket, og: OfficialGroup): Bracket {
  const matches: BracketMatch[] = br.matches.map((m) => ({ ...m }));
  const used = new Set<string>();
  const assign = (m: BracketMatch, g: OfficialGroup["games"][number]) => {
    used.add(m.id);
    if (g.date) m.date = g.date;
    m.time = g.time;
    m.officialSite = g.site ?? og.defaultSite;
    const names = g.slots.map((s) => s?.name).filter((n): n is string => !!n);
    const loser = names.find((n) => n !== g.winner);
    if (g.winner && g.score && loser) m.result = { winner: g.winner, loser, setsW: g.score[0], setsL: g.score[1] };
  };
  const later: OfficialGroup["games"] = [];
  for (const g of [...og.games].sort((x, y) => x.num - y.num)) {
    // A team's seeded (first) appearance pins the game to the match where our bracket lists it by name.
    const seeded = g.slots.filter((s) => s?.seeded).map((s) => s!.name);
    const m = seeded.length
      ? matches.find((x) => !used.has(x.id) && seeded.every((n) => x.top === n || x.bottom === n))
      : undefined;
    if (m) assign(m, g);
    else later.push(g);
  }
  // Games between advancing winners (finals) follow in round order.
  const open = matches.filter((m) => !used.has(m.id)).sort((x, y) => x.round - y.round);
  later.forEach((g, i) => open[i] && assign(open[i], g));
  return { ...br, matches };
}

/** District finals as a bracket, once NSAA has posted all eight pairings (null before). */
export function officialDistrictFinalsBracket(
  vbClass: VbClass,
  finals: Record<string, OfficialDistrictFinal> | undefined,
  recordOf: (name: string) => TeamRecord,
): Bracket | null {
  if (!finals) return null;
  const list = Array.from({ length: 8 }, (_, i) => finals[`${vbClass}-${i + 1}`]);
  if (list.some((f) => !f?.teams || f.teams.length !== 2)) return null;
  const matches: BracketMatch[] = list.map((f, i) => {
    const [hi, lo] = [...f!.teams!].sort((x, y) => x.seed - y.seed);
    const result: MatchResult | undefined =
      f!.winner && f!.score
        ? { winner: f!.winner, loser: f!.winner === hi.name ? lo.name : hi.name, setsW: f!.score[0], setsL: f!.score[1] }
        : undefined;
    return {
      id: `${vbClass}-DF${i + 1}`,
      round: 1,
      label: `District Final ${vbClass}-${i + 1} (#${hi.seed} vs #${lo.seed})`,
      top: hi.name,
      bottom: lo.name,
      host: siteHost(f!.host, hi.name, lo.name) ?? hi.name,
      officialSite: f!.host,
      date: f!.date,
      time: f!.time,
      result,
    };
  });
  const teams = list.flatMap((f) => f!.teams!).sort((x, y) => x.seed - y.seed);
  return {
    id: `${vbClass}-DF`,
    name: `Class ${vbClass} District Finals`,
    vbClass,
    teams: teams.map((t) => ({ ...recordOf(t.name), seed: t.seed })),
    matches,
  };
}

export interface ProjectionCheck {
  total: number;
  sameGroup: number;
  sameGroupAndSeed: number;
  misses: { team: string; projected: string; official: string }[];
}

/** How the rule-based projection compares with NSAA's official groups and seeds. */
export function compareProjection(projected: Group[], official: Group[]): ProjectionCheck {
  const where = (groups: Group[]) =>
    new Map(groups.flatMap((g) => g.teams.map((t) => [t.name, { group: g.id, seed: t.seed }] as const)));
  const p = where(projected);
  const o = where(official);
  const check: ProjectionCheck = { total: o.size, sameGroup: 0, sameGroupAndSeed: 0, misses: [] };
  for (const [team, off] of o) {
    const proj = p.get(team);
    if (proj?.group === off.group) {
      check.sameGroup++;
      if (proj.seed === off.seed) {
        check.sameGroupAndSeed++;
        continue;
      }
    }
    check.misses.push({
      team,
      projected: proj ? `${proj.group} #${proj.seed}` : "—",
      official: `${off.group} #${off.seed}`,
    });
  }
  return check;
}
