/**
 * Parsers for NSAA HTML pages:
 *  - Region assignments  (nsaaforms/regions/assignments.php?sport=vb&class=C2)
 *  - District / sub-district assignments (distassign.php?sport=vb — D1/D2 schools are listed before seeding)
 *  - Wildcard leaders    (wildcards/points/index.php?sport=vb&year=2026&class=B)
 *  (bracket pages and district finals: see parse-brackets.ts)
 */
import * as cheerio from "cheerio";
import type { RegionAssignment } from "../engine/seeding";

export function parseRegionAssignments(html: string): RegionAssignment[] {
  const $ = cheerio.load(html);
  const table = $("table").first();
  const headers = table
    .find("tr")
    .first()
    .find("th,td")
    .map((_, el) => $(el).text().trim())
    .get();
  const regions: RegionAssignment[] = headers.map((h) => ({
    region: Number(h.replace(/\D/g, "")) || 0,
    teams: [],
  }));
  table
    .find("tr")
    .slice(1)
    .each((_, tr) => {
      $(tr)
        .find("td")
        .each((i, td) => {
          const t = $(td).text().trim();
          if (t && regions[i]) regions[i].teams.push(t);
        });
    });
  return regions.filter((r) => r.region > 0);
}

/**
 * District / sub-district assignments page. Returns group id ("D1-7") → school names as NSAA lists them, which can
 * differ from the schedule-export names (e.g. a trailing "(BDS)"); match them with `matchTeamName`. Groups whose
 * schools aren't listed yet (A/B/C before seeding) come back empty.
 */
export function parseSubdistrictAssignments(html: string): Record<string, string[]> {
  const $ = cheerio.load(html);
  const out: Record<string, string[]> = {};
  let current: string | null = null;
  $("tr").each((_, tr) => {
    const heading = $(tr).text().match(/(?:Sub-?district|District)\s+([A-D][12]?-\d{1,2}):/i);
    if (heading) {
      current = heading[1].toUpperCase();
      out[current] = [];
      return;
    }
    const tds = $(tr).find("td");
    if (current && /Schools Assigned/i.test($(tds[0]).text())) {
      out[current] = ($(tds[1]).html() ?? "")
        .split(/<br\s*\/?>/i)
        .map((s) => cheerio.load(s).text().replace(/ /g, " ").trim())
        .filter(Boolean);
    }
  });
  return out;
}

/**
 * Find `name` among `candidates`. NSAA pages disagree on spelling, so in order: exact; ignoring case, punctuation
 * and parenthetical suffixes; same words in another order ("Omaha Concordia" / "Concordia Omaha"); the
 * parenthetical abbreviation ("BDS" / "Bruning-Davenport-Shickley (BDS)").
 */
export function matchTeamName(name: string, candidates: string[]): string | undefined {
  const norm = (s: string) =>
    s
      .toLowerCase()
      .replace(/\([^)]*\)/g, "")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  const words = (s: string) => norm(s).split(" ").sort().join(" ");
  const abbrev = (s: string) => s.match(/\(([^)]+)\)\s*$/)?.[1].toLowerCase().replace(/[^a-z0-9]+/g, "");
  const n = norm(name);
  const w = words(name);
  const a = name.toLowerCase().replace(/[^a-z0-9]+/g, "");
  return (
    candidates.find((c) => c === name) ??
    candidates.find((c) => norm(c) === n) ??
    candidates.find((c) => words(c) === w) ??
    candidates.find((c) => abbrev(c) === a)
  );
}

export interface LeaderRow {
  rank: number;
  school: string;
  sid?: number;
  wins: number;
  losses: number;
  avg: number;
}

export function parseWildcardLeaders(html: string): LeaderRow[] {
  const $ = cheerio.load(html);
  const rows: LeaderRow[] = [];
  $("table tr").each((_, tr) => {
    const tds = $(tr).find("td");
    if (tds.length < 4) return;
    const rank = Number($(tds[0]).text().trim());
    if (!rank) return;
    const a = $(tds[1]).find("a");
    const school = $(tds[1]).text().trim();
    const sidM = (a.attr("href") ?? "").match(/sid=(\d+)/);
    const [w, l] = $(tds[2]).text().trim().split("-").map(Number);
    const avg = Number($(tds[3]).text().trim());
    rows.push({ rank, school, sid: sidM ? Number(sidM[1]) : undefined, wins: w, losses: l, avg });
  });
  return rows;
}

/**
 * NSAA's "Regional Standings" page shows its own unofficial sub-district
 * snake. Returns sub-district id → ordered team names (highest seed first).
 */
export function parseRegionStandingsSubdistricts(html: string): Record<string, string[]> {
  const $ = cheerio.load(html);
  const out: Record<string, string[]> = {};
  $("table").each((_, table) => {
    const heads = $(table)
      .find("th")
      .map((_, th) => $(th).text().trim())
      .get()
      .filter((h) => /^[A-D][12]?-\d{1,2}$/.test(h));
    if (heads.length === 0) return;
    for (const h of heads) out[h] = [];
    $(table)
      .find("tr")
      .slice(1)
      .each((_, tr) => {
        const cells = $(tr)
          .find("td")
          .map((_, td) => $(td).text().trim())
          .get();
        // cells alternate: "Team (W-L)", "avg", "Team (W-L)", "avg", ...
        for (let i = 0; i < heads.length; i++) {
          const cell = cells[i * 2];
          if (!cell) continue;
          const name = cell.replace(/\s*\(\d+-\d+\)\s*$/, "").trim();
          if (name) out[heads[i]].push(name);
        }
      });
  });
  // Region 4 appears in the top table as "Region 4 (Subdistrict C2-10)"
  const topHeads = $("table").first().find("th").map((_, th) => $(th).text().trim()).get();
  const r4 = topHeads.findIndex((h) => /Subdistrict\s+([A-D][12]?-\d{1,2})/.test(h));
  if (r4 >= 0) {
    const id = topHeads[r4].match(/Subdistrict\s+([A-D][12]?-\d{1,2})/)![1];
    out[id] = [];
    $("table")
      .first()
      .find("tr")
      .slice(1)
      .each((_, tr) => {
        const cells = $(tr).find("td").map((_, td) => $(td).text().trim()).get();
        // first cell is the rank; then pairs
        const cell = cells[1 + (r4 - 1) * 2];
        if (cell) out[id].push(cell.replace(/\s*\(\d+-\d+\)\s*$/, "").trim());
      });
  }
  return out;
}
