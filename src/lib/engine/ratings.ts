/**
 * Set-level Bradley-Terry ratings with a home-court term.
 *
 *   P(team wins a set) = σ( r_team − r_opp + h · home )
 *   home ∈ {+1 (hosting), −1 (visiting), 0 (neutral / tournament)}
 *
 * Fitting on individual sets (rather than match outcomes) extracts more
 * signal from each match and lets us simulate best-of-3 and best-of-5 with
 * the same parameters. Ratings are regularised toward 0 (ridge), which keeps
 * sparsely-connected out-of-state teams near average.
 */
import type { Match } from "./types";

export interface Ratings {
  rating: Map<string, number>;
  /** Approximate standard error per team (from Fisher information). */
  se: Map<string, number>;
  /** Home-court advantage in set-logit units. */
  home: number;
  /** Sets observed per team */
  n: Map<string, number>;
}

export interface CanonicalMatch {
  key: string;
  date: string;
  a: string;
  b: string;
  /** +1 if a hosts, -1 if b hosts, 0 neutral */
  homeA: number;
  setsA: number;
  setsB: number;
  played: boolean;
  bestOf: 3 | 5;
}

/** Fold the per-team rows into one canonical row per match. */
export function canonicalize(matches: Match[]): CanonicalMatch[] {
  const map = new Map<string, CanonicalMatch>();
  for (const m of matches) {
    const [a, b] = [m.team, m.opponent].sort();
    const key = `${m.date}|${a}|${b}`;
    if (map.has(key)) continue;
    const teamIsA = m.team === a;
    const neutral = !!m.tournament;
    const homeTeam = neutral ? 0 : m.away ? -1 : 1; // from `team`'s perspective
    const homeA = teamIsA ? homeTeam : -homeTeam;
    let setsA = 0,
      setsB = 0;
    if (m.played && m.setsFor !== undefined && m.setsAgainst !== undefined) {
      setsA = teamIsA ? m.setsFor : m.setsAgainst;
      setsB = teamIsA ? m.setsAgainst : m.setsFor;
    }
    const bestOf: 3 | 5 = m.played && Math.max(setsA, setsB) >= 3 ? 5 : m.tournament ? 3 : 5;
    map.set(key, { key, date: m.date, a, b, homeA, setsA, setsB, played: m.played, bestOf });
  }
  return [...map.values()].sort((x, y) => x.date.localeCompare(y.date));
}

const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));

export interface FitOptions {
  lambda?: number; // ridge strength
  iters?: number;
  lr?: number;
  fitHome?: boolean;
  /**
   * Weight per set. Sets within a match are not independent trials, so a
   * weight < 1 keeps the fit honest about how much each match really tells us.
   */
  setWeight?: number;
}

export function fitRatings(canon: CanonicalMatch[], opts: FitOptions = {}): Ratings {
  const lambda = opts.lambda ?? 1.0;
  const iters = opts.iters ?? 300;
  const lr = opts.lr ?? 0.05;
  const w = opts.setWeight ?? 0.5;
  const teams = new Set<string>();
  for (const m of canon) {
    teams.add(m.a);
    teams.add(m.b);
  }
  const r = new Map<string, number>([...teams].map((t) => [t, 0]));
  const n = new Map<string, number>([...teams].map((t) => [t, 0]));
  const played = canon.filter((m) => m.played && m.setsA + m.setsB > 0);
  for (const m of played) {
    n.set(m.a, (n.get(m.a) ?? 0) + w * (m.setsA + m.setsB));
    n.set(m.b, (n.get(m.b) ?? 0) + w * (m.setsA + m.setsB));
  }
  let home = 0.15;
  for (let it = 0; it < iters; it++) {
    const g = new Map<string, number>();
    let gh = 0;
    for (const m of played) {
      const x = (r.get(m.a) ?? 0) - (r.get(m.b) ?? 0) + home * m.homeA;
      const p = sigmoid(x);
      // each set is a Bernoulli trial for a
      const grad = w * (m.setsA * (1 - p) - m.setsB * p); // d logL / dx
      g.set(m.a, (g.get(m.a) ?? 0) + grad);
      g.set(m.b, (g.get(m.b) ?? 0) - grad);
      gh += grad * m.homeA;
    }
    for (const t of teams) {
      const cnt = n.get(t) ?? 0;
      const step = ((g.get(t) ?? 0) - lambda * (r.get(t) ?? 0)) / (cnt * 0.25 + lambda);
      r.set(t, (r.get(t) ?? 0) + lr * 4 * step); // normalised Newton-ish step
    }
    if (opts.fitHome !== false) {
      const nh = played.reduce((s, m) => s + (m.homeA ? w * (m.setsA + m.setsB) : 0), 0);
      home += (lr * 4 * (gh - 2 * home)) / (nh * 0.25 + 2);
    }
  }
  // Center ratings at 0 mean
  const mean = [...r.values()].reduce((a, b) => a + b, 0) / Math.max(1, r.size);
  for (const t of teams) r.set(t, (r.get(t) ?? 0) - mean);
  const se = new Map<string, number>();
  for (const t of teams) se.set(t, 1 / Math.sqrt((n.get(t) ?? 0) * 0.25 + lambda));
  return { rating: r, se, home, n };
}

/** P(a beats b in one set). home: +1 a hosts, -1 b hosts, 0 neutral. */
export function setWinProb(ratings: Ratings, a: string, b: string, home = 0, override?: Map<string, number>): number {
  const ra = override?.get(a) ?? ratings.rating.get(a) ?? 0;
  const rb = override?.get(b) ?? ratings.rating.get(b) ?? 0;
  return sigmoid(ra - rb + ratings.home * home);
}

/** Exact P(a wins a best-of-N match) given per-set probability p. */
export function matchWinProb(p: number, bestOf: 3 | 5 = 5): number {
  const need = bestOf === 5 ? 3 : 2;
  // P(win) = Σ_{k=0}^{need-1} C(need-1+k, k) p^need (1-p)^k
  let total = 0;
  for (let k = 0; k < need; k++) total += choose(need - 1 + k, k) * p ** need * (1 - p) ** k;
  return total;
}

function choose(n: number, k: number): number {
  let r = 1;
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
  return r;
}

/** Simulate a best-of-N match; returns [setsA, setsB]. */
export function simulateMatch(p: number, bestOf: 3 | 5, rng: () => number): [number, number] {
  const need = bestOf === 5 ? 3 : 2;
  let a = 0,
    b = 0;
  while (a < need && b < need) {
    if (rng() < p) a++;
    else b++;
  }
  return [a, b];
}

/** Simple seeded PRNG (mulberry32) for reproducible simulations. */
export function makeRng(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let x = t;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

export function gaussian(rng: () => number): number {
  let u = 0,
    v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
