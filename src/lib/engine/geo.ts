/**
 * School geography for host/site rules. Coordinates are approximate town
 * centers (good to a mile or two), which is all the 300-mile / "closer than
 * the #1 seed" rules need.
 */
import type { School } from "./types";

export type Geo = Map<string, School>;

const S = (name: string, city: string, lat: number, lon: number): School => ({ name, city, lat, lon });

export const SCHOOLS_2026: School[] = [
  // ── Class B ───────────────────────────────────────────────────────────────
  S("Norris", "Firth", 40.536, -96.605),
  S("Waverly", "Waverly", 40.918, -96.528),
  S("Gretna", "Gretna", 41.141, -96.240),
  S("Northwest", "Grand Island", 40.945, -98.370),
  S("Omaha Skutt Catholic", "Omaha", 41.218, -96.112),
  S("Gering", "Gering", 41.826, -103.659),
  S("Lincoln Pius X", "Lincoln", 40.830, -96.660),
  S("York", "York", 40.868, -97.592),
  S("Columbus Lakeview", "Columbus", 41.470, -97.355),
  S("Gretna East", "Gretna", 41.120, -96.210),
  S("Adams Central", "Hastings", 40.600, -98.420),
  S("Platteview", "Springfield", 41.082, -96.134),
  S("Elkhorn", "Elkhorn", 41.287, -96.236),
  S("South Sioux City", "South Sioux City", 42.474, -96.414),
  S("Omaha Gross Catholic", "Bellevue", 41.160, -95.950),
  S("Scottsbluff", "Scottsbluff", 41.867, -103.667),
  S("Seward", "Seward", 40.907, -97.099),
  S("Omaha Duchesne Academy", "Omaha", 41.265, -95.960),
  S("Omaha Mercy", "Omaha", 41.230, -95.990),
  S("McCook", "McCook", 40.202, -100.626),
  S("Blair", "Blair", 41.545, -96.125),
  S("North Platte", "North Platte", 41.124, -100.765),
  S("Crete", "Crete", 40.628, -96.961),
  S("Lexington", "Lexington", 40.781, -99.742),
  S("Beatrice", "Beatrice", 40.268, -96.747),
  S("Plattsmouth", "Plattsmouth", 41.011, -95.888),
  S("Nebraska City", "Nebraska City", 40.677, -95.859),
  S("Alliance", "Alliance", 42.102, -102.872),
  S("Ralston", "Ralston", 41.202, -96.044),
  S("Hastings", "Hastings", 40.586, -98.389),
  S("Schuyler", "Schuyler", 41.447, -97.059),
  // ── Class C2 Region 1 ─────────────────────────────────────────────────────
  S("Bergan Catholic", "Fremont", 41.433, -96.498),
  S("Cedar Bluffs", "Cedar Bluffs", 41.399, -96.608),
  S("Cornerstone Christian", "Bellevue", 41.150, -95.920),
  S("Elmwood-Murdock", "Elmwood", 40.839, -96.295),
  S("Freeman", "Adams", 40.457, -96.512),
  S("Guardian Angels Central Catholic", "West Point", 41.842, -96.709),
  S("Howells-Dodge", "Howells", 41.726, -96.996),
  S("Humphrey-Lindsay", "Humphrey", 41.689, -97.491),
  S("Johnson County Central", "Tecumseh", 40.367, -96.191),
  S("Johnson-Brock", "Johnson", 40.413, -96.021),
  S("Oakland-Craig", "Oakland", 41.835, -96.467),
  S("Omaha Brownell Talbot", "Omaha", 41.270, -95.990),
  S("Shelby-Rising City", "Shelby", 41.195, -97.426),
  S("Southern", "Wymore", 40.122, -96.663),
  S("Tekamah-Herman", "Tekamah", 41.778, -96.228),
  S("Thayer Central", "Hebron", 40.166, -97.586),
  S("Yutan", "Yutan", 41.245, -96.397),
  // ── Class C2 Region 2 ─────────────────────────────────────────────────────
  S("Boyd County", "Spencer", 42.874, -98.700),
  S("Crofton", "Crofton", 42.731, -97.496),
  S("Elkhorn Valley", "Tilden", 42.045, -97.834),
  S("Homer", "Homer", 42.322, -96.491),
  S("Laurel-Concord-Coleridge", "Laurel", 42.429, -97.089),
  S("Lutheran High Northeast", "Norfolk", 42.028, -97.417),
  S("Neligh-Oakdale", "Neligh", 42.129, -98.030),
  S("Omaha Nation", "Macy", 42.114, -96.359),
  S("Pender", "Pender", 42.112, -96.709),
  S("Ponca", "Ponca", 42.566, -96.708),
  S("Stanton", "Stanton", 41.950, -97.223),
  S("Summerland", "Ewing", 42.261, -98.344),
  S("Wakefield", "Wakefield", 42.269, -96.866),
  S("West Holt", "Atkinson", 42.531, -98.978),
  S("Winnebago", "Winnebago", 42.237, -96.472),
  S("Wisner-Pilger", "Wisner", 41.987, -96.914),
  // ── Class C2 Region 3 ─────────────────────────────────────────────────────
  S("Alma", "Alma", 40.097, -99.361),
  S("Arcadia/Loup City", "Loup City", 41.276, -98.967),
  S("Centura", "Cairo", 41.000, -98.606),
  S("Doniphan-Trumbull", "Doniphan", 40.773, -98.371),
  S("Elm Creek", "Elm Creek", 40.721, -99.373),
  S("H&H", "Hampton", 40.878, -97.887), // TODO verify co-op home site
  S("Hastings St. Cecilia", "Hastings", 40.586, -98.389),
  S("Hi-Line", "Elwood", 40.590, -99.861),
  S("Kenesaw", "Kenesaw", 40.619, -98.657),
  S("Maxwell", "Maxwell", 41.079, -100.525),
  S("Maywood-Hayes Center", "Maywood", 40.657, -100.621),
  S("Nebraska Christian", "Central City", 41.116, -98.001),
  S("Ravenna", "Ravenna", 41.027, -98.912),
  S("Sandy Creek", "Fairfield", 40.428, -98.103),
  S("South Loup (Callaway/Arnold)", "Callaway", 41.293, -99.922),
  S("Superior", "Superior", 40.021, -98.070),
  S("Sutton", "Sutton", 40.606, -97.859),
  // ── Class C2 Region 4 ─────────────────────────────────────────────────────
  S("Bridgeport", "Bridgeport", 41.665, -103.099),
  S("Hershey", "Hershey", 41.157, -101.000),
  S("Mitchell", "Mitchell", 41.940, -103.808),
  S("North Platte St. Patrick's", "North Platte", 41.124, -100.765),
  S("Perkins County", "Grant", 40.842, -101.725),
  // ── Class B neutral sites ─────────────────────────────────────────────────
  S("Grand Island Northwest", "Grand Island", 40.945, -98.370),
  S("Lincoln", "Lincoln", 40.814, -96.702),
];

export function buildGeo(schools: School[] = SCHOOLS_2026): Geo {
  return new Map(schools.map((s) => [s.name, s]));
}

export function haversineMiles(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 3958.8;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Straight-line distance between two schools (undefined if either is unknown). */
export function distanceMiles(geo: Geo, a: string, b: string): number | undefined {
  const sa = geo.get(a);
  const sb = geo.get(b);
  if (!sa || !sb) return undefined;
  // Road miles run ~15–20% longer than straight-line in Nebraska's grid.
  return haversineMiles(sa.lat, sa.lon, sb.lat, sb.lon) * 1.17;
}
