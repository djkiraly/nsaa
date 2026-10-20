/**
 * Visitor location from IP, looked up locally in DB-IP's free IP-to-City Lite database (CC BY 4.0 — the analytics
 * page credits it). `npm run geoip` downloads it to data/geo/; without the file, locations are simply unknown.
 * Only the place name is kept — the IP itself is never stored.
 */
import maxmind, { type CityResponse, type Reader } from "maxmind";
import { existsSync } from "node:fs";
import { join } from "node:path";

// A fixed path: a dynamic one (e.g. from an env var) makes Turbopack trace the whole project into the build.
export const GEOIP_PATH = join(process.cwd(), "data", "geo", "dbip-city-lite.mmdb");

export interface Place {
  country?: string;
  region?: string;
  city?: string;
}

let reader: Promise<Reader<CityResponse> | null> | null = null;

async function open(): Promise<Reader<CityResponse> | null> {
  if (!reader) {
    if (!existsSync(GEOIP_PATH)) return null; // try again on a later request, once it's been downloaded
    // watchForUpdates: the monthly download replaces the file in place; pick it up without a restart. Non-persistent
    // so the watcher doesn't keep one-off scripts and tests from exiting.
    reader = maxmind.open<CityResponse>(GEOIP_PATH, { watchForUpdates: true, watchForUpdatesNonPersistent: true }).catch((e) => {
      console.warn(`[geo] can't open ${GEOIP_PATH}: ${e instanceof Error ? e.message : e}`);
      reader = null;
      return null;
    });
  }
  return reader;
}

export async function locate(ip: string | null | undefined): Promise<Place> {
  if (!ip || !maxmind.validate(ip)) return {};
  const hit = (await open())?.get(ip);
  if (!hit) return {};
  return {
    country: hit.country?.names?.en ?? hit.country?.iso_code,
    region: hit.subdivisions?.[0]?.names?.en,
    // DB-IP adds neighborhoods ("Omaha (Jefferson Square)"); keep the city so it doesn't split across rows.
    city: hit.city?.names?.en?.replace(/\s*\([^)]*\)\s*$/, ""),
  };
}
