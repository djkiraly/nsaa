/**
 * Parsers for NSAA HTML pages:
 *  - Region assignments  (nsaaforms/regions/assignments.php?sport=vb&class=C2)
 *  - Wildcard leaders    (wildcards/points/index.php?sport=vb&year=2026&class=B)
 *  - Bracket pages       (nsaaforms/officials/vbbrackets.php?distid=N)
 *  - District finals     (nsaaforms/officials/vbfinals.php)
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

export interface BracketPageMatch {
  text: string;
}

/**
 * Bracket pages are free-form; we capture the raw text blocks so the agent can
 * read site/time info, and attempt to extract "Team def. Team" results.
 */
export function parseBracketPage(html: string): { title: string; available: boolean; text: string; results: { winner: string; loser: string; score?: string }[] } {
  const $ = cheerio.load(html);
  const title = $("h1").first().text().trim();
  const text = $("body").text().replace(/\s+\n/g, "\n").replace(/[ \t]+/g, " ").trim();
  const available = !/Information not available/i.test(text);
  const results: { winner: string; loser: string; score?: string }[] = [];
  const re = /([A-Za-z.'&\/\- ()]+?)\s+(?:def\.|defeated|over)\s+([A-Za-z.'&\/\- ()]+?)(?:[,\s]+((?:\d+-\d+[,\s]*)+))?(?:\n|$)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    results.push({ winner: m[1].trim(), loser: m[2].trim(), score: m[3]?.trim() });
  }
  return { title, available, text, results };
}

export interface DistrictFinalInfo {
  id: string; // "C2-3"
  date?: string;
  host?: string;
  teams?: string;
  winner?: string;
}

export function parseDistrictFinals(html: string): DistrictFinalInfo[] {
  const $ = cheerio.load(html);
  const text = $("body").text();
  const out: DistrictFinalInfo[] = [];
  const blocks = text.split(/(?=\b[A-D][12]?-\d{1,2} District Final:)/);
  for (const b of blocks) {
    const idM = b.match(/\b([A-D][12]?-\d{1,2}) District Final:/);
    if (!idM) continue;
    const date = b.match(/(\w+ \d{1,2}, \d{4})/)?.[1];
    const host = b.match(/Host \(Site\):\s*(.+)/)?.[1]?.trim();
    const teams = b.match(/Teams:\s*(.+)/)?.[1]?.trim();
    const winner = b.match(/WINNER:\s*(.+)/)?.[1]?.trim();
    out.push({ id: idM[1], date, host, teams, winner: winner || undefined });
  }
  return out;
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
