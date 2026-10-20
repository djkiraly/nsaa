/** CLI: download NSAA pages into data/raw (and into the DB when DATABASE_URL is set). */
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { NSAA_URLS } from "../src/lib/data/load";
import { CLASS_ORDER } from "../src/lib/engine/types";

const SEASON = Number(process.env.NSAA_SEASON ?? 2026);
const RAW = join(process.cwd(), "data", "raw");
mkdirSync(RAW, { recursive: true });

async function get(url: string) {
  const r = await fetch(url, { headers: { "user-agent": "nsaa-volleyball-agent/0.1" } });
  if (!r.ok) throw new Error(`${url} → ${r.status}`);
  return r.text();
}

(async () => {
  for (const c of CLASS_ORDER) {
    writeFileSync(join(RAW, `vb_${c}.csv`), await get(NSAA_URLS.exportCsv(c)));
    writeFileSync(join(RAW, `points_${c}.html`), await get(NSAA_URLS.leaders(c, SEASON)));
    if (c === "C1" || c === "C2") {
      writeFileSync(join(RAW, `regions_${c}.html`), await get(NSAA_URLS.regions(c)));
      writeFileSync(join(RAW, `standings_${c}.html`), await get(NSAA_URLS.regionStandings(c)));
    }
    console.log(`fetched ${c}`);
  }
  writeFileSync(join(RAW, `district_finals.html`), await get(NSAA_URLS.districtFinals));
  if (process.env.DATABASE_URL) {
    const { refreshSnapshots } = await import("../src/lib/data/season");
    const { stored } = await refreshSnapshots();
    console.log(`stored ${stored.length} snapshots in DB`);
  }
})();
