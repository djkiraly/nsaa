/**
 * Parser for NSAA wildcard schedule exports:
 *   https://secure.nsaahome.org/wildcards/schedules/export.php?sport=vb&class=B&cutoff_only=1
 *
 * Columns:
 *   Date,School,Opponent,Class,Wins,Losses,Division,Score,Notes,Points,Tournament,"Tournament Location"
 *
 * Quirks handled:
 *  - Dates are "Thu 27 Aug" with no year → we attach the season year.
 *  - Tournament header rows have an empty Opponent (just Tournament/Location).
 *  - Opponent prefixed "@ " means away.
 *  - Score uses "&ndash;" between set counts, e.g. "3&ndash;1".
 *  - Unplayed matches have an empty Score and Points.
 *  - Out-of-state opponents look like "Sundance, WY".
 */
import type { Division, Match, VbClass } from "../engine/types";

const MONTHS: Record<string, number> = {
  Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6,
  Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12,
};

export function parseNsaaDate(s: string, seasonYear: number): string {
  // "Thu 27 Aug" or "Fri 28 Aug - Sat 29 Aug" (take the first)
  const m = s.match(/(\d{1,2})\s+([A-Z][a-z]{2})/);
  if (!m) throw new Error(`Bad NSAA date: ${s}`);
  const day = Number(m[1]);
  const mon = MONTHS[m[2]];
  // Volleyball season runs Aug–Nov, all in the same calendar year.
  return `${seasonYear}-${String(mon).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Minimal RFC4180-ish CSV line splitter (handles quoted fields with commas). */
export function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else inQ = false;
      } else cur += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  out.push(cur);
  return out;
}

export interface ParsedExport {
  matches: Match[];
  /** Team name → class, for every team whose schedule appears (the class in the export). */
  teams: Map<string, VbClass>;
}

export function parseNsaaExport(
  csv: string,
  vbClass: VbClass,
  seasonYear: number,
): ParsedExport {
  const lines = csv.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const header = splitCsvLine(lines[0]);
  const idx = (name: string) => {
    const i = header.indexOf(name);
    if (i < 0) throw new Error(`Missing column ${name}`);
    return i;
  };
  const cDate = idx("Date"),
    cSchool = idx("School"),
    cOpp = idx("Opponent"),
    cClass = idx("Class"),
    cW = idx("Wins"),
    cL = idx("Losses"),
    cDiv = idx("Division"),
    cScore = idx("Score"),
    cPts = idx("Points"),
    cTour = idx("Tournament"),
    cLoc = idx("Tournament Location");

  const matches: Match[] = [];
  const teams = new Map<string, VbClass>();

  for (let i = 1; i < lines.length; i++) {
    const f = splitCsvLine(lines[i]);
    const school = f[cSchool]?.trim();
    if (!school) continue;
    teams.set(school, vbClass);
    let opp = (f[cOpp] ?? "").trim();
    if (!opp) continue; // tournament header row
    const away = opp.startsWith("@");
    if (away) opp = opp.replace(/^@\s*/, "");
    const oppClass = (f[cClass] || "D2").trim() as VbClass;
    const oppW = Number(f[cW] || 0);
    const oppL = Number(f[cL] || 0);
    const oppDiv = (Number(f[cDiv] || 4) as Division) || 4;
    const scoreRaw = (f[cScore] ?? "").replace(/&ndash;|–|—/g, "-").trim();
    const ptsRaw = (f[cPts] ?? "").trim();
    const played = /^\d+\s*-\s*\d+$/.test(scoreRaw) && ptsRaw !== "" && ptsRaw !== "-";
    let setsFor: number | undefined, setsAgainst: number | undefined, won: boolean | undefined;
    if (played) {
      const [a, b] = scoreRaw.split("-").map((x) => Number(x.trim()));
      setsFor = a;
      setsAgainst = b;
      won = a > b;
    }
    matches.push({
      date: parseNsaaDate(f[cDate], seasonYear),
      team: school,
      opponent: opp,
      opponentClass: oppClass,
      opponentWins: oppW,
      opponentLosses: oppL,
      opponentDivision: oppDiv,
      away,
      played,
      won,
      setsFor,
      setsAgainst,
      points: played ? Number(ptsRaw) : undefined,
      tournament: f[cTour]?.trim() || undefined,
      tournamentLocation: f[cLoc]?.trim() || undefined,
    });
  }
  return { matches, teams };
}

export function isOutOfState(name: string): boolean {
  return /,\s*[A-Z]{2}$/.test(name);
}
