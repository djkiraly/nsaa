/**
 * Download DB-IP's free IP-to-City Lite database (CC BY 4.0, updated monthly) to data/geo/dbip-city-lite.mmdb —
 * the analytics' visitor locations come from it. ~60 MB download, ~130 MB on disk.
 *
 *   node scripts/geoip.mjs                     always download
 *   node scripts/geoip.mjs --max-age-days 30   only if the file is missing or older (installer / nightly update)
 *
 * The running app notices the replaced file on its own (maxmind watchForUpdates).
 */
import { createWriteStream, existsSync, mkdirSync, renameSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";

const dir = join(process.cwd(), "data", "geo");
const out = join(dir, "dbip-city-lite.mmdb");
const i = process.argv.indexOf("--max-age-days");
const maxAgeDays = i > 0 ? Number(process.argv[i + 1]) : 0;

if (maxAgeDays && existsSync(out)) {
  const age = (Date.now() - statSync(out).mtimeMs) / 86_400_000;
  if (age < maxAgeDays) {
    console.log(`geoip: ${out} is ${age.toFixed(0)} days old — keeping it`);
    process.exit(0);
  }
}

mkdirSync(dir, { recursive: true });
const month = (d) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
const now = new Date();
const lastMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 15));
// Early in a month the new file may not be published yet; fall back to last month's.
for (const m of [month(now), month(lastMonth)]) {
  const url = `https://download.db-ip.com/free/dbip-city-lite-${m}.mmdb.gz`;
  const res = await fetch(url, { headers: { "user-agent": "nsaa-volleyball-agent/0.1" } });
  if (!res.ok || !res.body) {
    console.log(`geoip: ${url} → ${res.status}`);
    continue;
  }
  const tmp = `${out}.download`;
  try {
    await pipeline(Readable.fromWeb(res.body), createGunzip(), createWriteStream(tmp));
    renameSync(tmp, out);
  } catch (e) {
    rmSync(tmp, { force: true });
    throw e;
  }
  console.log(`geoip: saved ${m} database → ${out}`);
  process.exit(0);
}
console.error("geoip: no database could be downloaded");
process.exit(1);
