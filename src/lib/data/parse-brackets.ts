/**
 * Parsers for NSAA's postseason pages:
 *  - bracket pages    nsaaforms/officials/vbbrackets.php?distid=N  (pairings from seeding day, then results)
 *  - district finals  nsaaforms/officials/vbfinals.php
 *
 * NSAA has used two bracket layouts: the classic nested tables (volleyball through 2025) and Bootstrap cards
 * (softball 2026 — the 2026 volleyball stub pages load the same assets). Both read into the same shape:
 *  - a game box ("Match 3 / 10/30/2025 / 6:00 PM CT / @ Waverly") with a top and a bottom team slot;
 *  - a team's first appearance is seeded: "#4 Omaha Duchesne Academy 39.1111 (9-25)" (seed, average, record);
 *  - a winner reappears unseeded in its next game with that game's score: "Omaha Duchesne Academy (3-0)";
 *  - the champion sits alone after the final.
 * Results are inferred from those reappearances. Samples of every state live in tests/fixtures/nsaa.
 */
import * as cheerio from "cheerio";
import type { CheerioAPI } from "cheerio";

export interface BracketEntry {
  name: string;
  seed?: number;
  avg?: number;
  wins?: number;
  losses?: number;
  /** On an advancing (unseeded) entry: the score of the game it just won. */
  score?: [number, number];
}

export interface BracketGame {
  num: number;
  date?: string;
  time?: string;
  site?: string;
  top?: BracketEntry;
  bottom?: BracketEntry;
  winner?: string;
  score?: [number, number];
}

export interface ParsedBracket {
  title: string;
  available: boolean;
  defaultSite?: string;
  games: BracketGame[];
  champion?: BracketEntry;
  seeds: { name: string; seed: number; avg?: number }[];
}

const clean = (s: string) => s.replace(/ /g, " ").replace(/\s+/g, " ").trim();

export function parseEntry(raw: string): BracketEntry | undefined {
  const t = clean(raw);
  if (!t || /^winner$/i.test(t)) return undefined;
  const m = t.match(/^(?:#(\d+)\s+)?(.+?)(?:\s+(\d+\.\d+))?(?:\s*\((\d+)-(\d+)\))?$/);
  if (!m) return { name: t };
  const [, seed, name, avg, a, b] = m;
  const e: BracketEntry = { name: name.trim() };
  if (seed) {
    e.seed = Number(seed);
    if (avg) e.avg = Number(avg);
    if (a) [e.wins, e.losses] = [Number(a), Number(b)];
  } else if (a) e.score = [Number(a), Number(b)];
  return e;
}

/** "Match 1 / 10/28/2025 / 6:00 PM CT / @ Duchesne" (lines) → game header fields. */
function parseHeader(lines: string[]): Omit<BracketGame, "top" | "bottom"> | undefined {
  const num = lines[0]?.match(/^(?:Match|Game)\s+(\d+)/i);
  if (!num) return undefined;
  const g: Omit<BracketGame, "top" | "bottom"> = { num: Number(num[1]) };
  for (const line of lines.slice(1)) {
    const d = line.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (d) g.date = `${d[3]}-${d[1].padStart(2, "0")}-${d[2].padStart(2, "0")}`;
    else if (/^\d{1,2}:\d{2}\s*[AP]M/i.test(line)) g.time = line;
    else if (line.startsWith("@")) {
      const site = clean(line.slice(1));
      if (!/^(TBA|TBD)$/i.test(site)) g.site = site; // not decided yet → the rule-based host applies
    }
  }
  return g;
}

/** Text of an element split on <br>, blank lines dropped. */
function lines($: CheerioAPI, el: Parameters<CheerioAPI>[0]): string[] {
  const html = $(el).html() ?? "";
  return html
    .split(/<br\s*\/?>/i)
    .map((s) => clean(cheerio.load(s).text()))
    .filter(Boolean);
}

/** Classic layout: each game box is a `td.border`; its top/bottom teams are the cells in the rows above/below. */
function parseTableLayout($: CheerioAPI): { games: BracketGame[]; champion?: BracketEntry } {
  const games: BracketGame[] = [];
  let champion: BracketEntry | undefined;
  $("td.border").each((_, td) => {
    const header = parseHeader(lines($, td));
    if (!header) {
      // The box after the final: "WINNER" until decided, then the champion.
      champion ??= parseEntry($(td).text());
      return;
    }
    const tr = $(td).closest("tr");
    games.push({
      ...header,
      top: parseEntry(tr.prev("tr").text()),
      bottom: parseEntry(tr.next("tr").text()),
    });
  });
  // Older pages put the champion above the WINNER box rather than inside it.
  if (!champion) {
    const last = $("td.border").last().closest("tr");
    champion = parseEntry(last.prev("tr").text()) ?? parseEntry(last.next("tr").text());
  }
  return { games, champion };
}

/** Card layout: `.card` with a `.card-header` and `[data-team=top|bot]` slots; the champion box id ends in "-w<n>". */
function parseCardLayout($: CheerioAPI): { games: BracketGame[]; champion?: BracketEntry } {
  const byNum = new Map<number, BracketGame>();
  let champion: BracketEntry | undefined;
  $(".card").each((_, card) => {
    if ($(card).closest('[aria-hidden="true"]').length) return; // layout spacer clones
    const head = $(card).children(".card-header").first();
    const header = head.length ? parseHeader(lines($, head[0])) : undefined;
    if (!header || byNum.has(header.num)) return;
    byNum.set(header.num, {
      ...header,
      top: parseEntry($(card).find('[data-team="top"]').first().text()),
      bottom: parseEntry($(card).find('[data-team="bot"], [data-team="bottom"]').first().text()),
    });
  });
  $("[id]")
    .filter((_, el) => /-w\d+$/.test($(el).attr("id") ?? ""))
    .each((_, el) => {
      if ($(el).closest('[aria-hidden="true"]').length) return;
      champion = parseEntry($(el).text()) ?? champion; // last one wins (the final's)
    });
  return { games: [...byNum.values()], champion };
}

/**
 * Winners: an advancing entry with a score in game H won the most recent earlier game that included that team and
 * has no winner yet; the champion entry closes out the final.
 */
function inferResults(games: BracketGame[], champion?: BracketEntry) {
  const sorted = [...games].sort((a, b) => a.num - b.num);
  const has = (g: BracketGame, name: string) => g.top?.name === name || g.bottom?.name === name;
  const credit = (e: BracketEntry | undefined, before: number) => {
    if (!e || e.seed !== undefined || !e.score) return;
    const g = sorted.filter((x) => x.num < before && !x.winner && has(x, e.name)).at(-1);
    if (g) [g.winner, g.score] = [e.name, e.score];
  };
  for (const g of sorted) {
    credit(g.top, g.num);
    credit(g.bottom, g.num);
  }
  credit(champion, Infinity);
  return sorted;
}

export function parseBracketPage(html: string): ParsedBracket {
  const $ = cheerio.load(html);
  const h1 = $("h1").first();
  const title = clean(h1.clone().children("small").remove().end().text());
  const available = !/Information not available/i.test($("body").text());
  const defaultSite =
    title.match(/\s+at\s+(.+)$/i)?.[1] ?? clean(h1.find("small").text()).match(/^Site:\s*(.+)$/i)?.[1];
  const { games, champion } = $("[data-team]").length ? parseCardLayout($) : parseTableLayout($);
  const sorted = available ? inferResults(games, champion) : [];
  const seeds = new Map<string, { name: string; seed: number; avg?: number }>();
  for (const g of sorted)
    for (const e of [g.top, g.bottom])
      if (e?.seed !== undefined && !seeds.has(e.name)) seeds.set(e.name, { name: e.name, seed: e.seed, avg: e.avg });
  return {
    title,
    available,
    defaultSite,
    games: sorted,
    champion: available ? champion : undefined,
    seeds: [...seeds.values()].sort((a, b) => a.seed - b.seed),
  };
}

export interface ParsedDistrictFinal {
  id: string;
  date?: string;
  time?: string;
  host?: string;
  teams?: { name: string; seed: number }[];
  winner?: string;
  score?: [number, number];
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/**
 * District finals page: one block per final —
 *   "C1-1 District Final: / November 1, 2025 @ 1:00 PM MT / Host (Site): Ogallala (Ogallala) /
 *    Teams: Ogallala (#1) VS Battle Creek (#16) / WINNER: Ogallala (3-0)"
 * Before pairings: "Host (Site): TBA", "Teams: To be determined", empty "WINNER:".
 */
export function parseDistrictFinals(html: string): ParsedDistrictFinal[] {
  const $ = cheerio.load(html.replace(/<br\s*\/?>/gi, "\n"));
  const text = $("body").text();
  const out: ParsedDistrictFinal[] = [];
  for (const block of text.split(/(?=\b[A-D][12]?-\d{1,2} District Final:)/)) {
    const id = block.match(/^([A-D][12]?-\d{1,2}) District Final:/)?.[1];
    if (!id) continue;
    const f: ParsedDistrictFinal = { id };
    const when = block.match(/\b([A-Z][a-z]+) (\d{1,2}), (\d{4})(?:\s*@\s*(\d{1,2}:\d{2}\s*[AP]M(?:\s*[A-Z]{2})?))?/);
    if (when) {
      const mon = MONTHS.indexOf(when[1]) + 1;
      if (mon) f.date = `${when[3]}-${String(mon).padStart(2, "0")}-${when[2].padStart(2, "0")}`;
      if (when[4]) f.time = clean(when[4]);
    }
    const host = clean(block.match(/Host \(Site\):([^\n]*)/)?.[1] ?? "");
    if (host && !/^TBA$/i.test(host)) f.host = host.replace(/\s*\(.*\)\s*$/, "");
    const teams = block.match(/Teams:\s*([^\n]+?)\s*\(#(\d+)\)\s*VS\s*([^\n]+?)\s*\(#(\d+)\)/i);
    if (teams)
      f.teams = [
        { name: clean(teams[1]), seed: Number(teams[2]) },
        { name: clean(teams[3]), seed: Number(teams[4]) },
      ];
    const won = block.match(/WINNER:\s*([^\n(]+?)\s*\((\d+)-(\d+)\)/);
    if (won) [f.winner, f.score] = [clean(won[1]), [Number(won[2]), Number(won[3])]];
    out.push(f);
  }
  return out;
}
