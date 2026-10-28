/** Read side of the analytics: everything the /analytics page shows, for one time range. Times are Central. */
import { sql, type SQL } from "drizzle-orm";
import { db } from "../db";

export const TZ = "America/Chicago";

export const RANGES = {
  "24h": { label: "Last 24 hours", hours: 24, unit: "hour" },
  "7d": { label: "Last 7 days", hours: 24 * 7, unit: "day" },
  "30d": { label: "Last 30 days", hours: 24 * 30, unit: "day" },
  all: { label: "All time", hours: null, unit: "day" },
} as const;
export type RangeKey = keyof typeof RANGES;

export interface Bucket {
  key: string;
  label: string;
  visits: number;
  visitors: number;
}

export interface Ranked {
  label: string;
  detail?: string;
  visits: number;
  visitors: number;
}

export interface RecentVisit {
  id: string;
  startedAt: Date;
  chats: number;
  seconds: number;
  pageviews: number;
  entryPath: string | null;
  place: string;
  device: string | null;
  browser: string | null;
  referrer: string | null;
}

export interface Dashboard {
  range: RangeKey;
  since: Date;
  visitors: number;
  returningVisitors: number;
  visits: number;
  pageviews: number;
  avgSeconds: number;
  medianSeconds: number;
  bounceRate: number;
  chats: number;
  activeNow: number;
  series: Bucket[];
  unit: "hour" | "day";
  pages: Ranked[];
  regions: Ranked[];
  cities: Ranked[];
  sources: Ranked[];
  devices: Ranked[];
  browsers: Ranked[];
  recent: RecentVisit[];
}

const rows = async <T>(q: SQL): Promise<T[]> => (await db!.execute(q)).rows as T[];

const PARTS = new Intl.DateTimeFormat("en-CA", {
  timeZone: TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  hourCycle: "h23",
});

/** Central-time bucket key, matching the SQL's to_char format. */
export function bucketKey(d: Date, unit: "hour" | "day"): string {
  const p = Object.fromEntries(PARTS.formatToParts(d).map((x) => [x.type, x.value]));
  return unit === "day" ? `${p.year}-${p.month}-${p.day}` : `${p.year}-${p.month}-${p.day}T${p.hour}`;
}

export function bucketLabel(key: string, unit: "hour" | "day"): string {
  const day = new Date(`${key.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
  });
  if (unit === "day") return day;
  const h = Number(key.slice(11, 13));
  return `${day}, ${h % 12 || 12} ${h < 12 ? "AM" : "PM"}`;
}

/** Every bucket between since and until (stepping hourly, so DST days aren't skipped or doubled). */
export function bucketKeys(since: Date, until: Date, unit: "hour" | "day"): string[] {
  const keys = new Set<string>();
  const start = new Date(since);
  start.setUTCMinutes(0, 0, 0);
  for (let t = start.getTime(); t <= until.getTime(); t += 3_600_000) keys.add(bucketKey(new Date(t), unit));
  keys.add(bucketKey(until, unit));
  return [...keys];
}

export async function getDashboard(range: RangeKey): Promise<Dashboard> {
  const r = RANGES[range];
  const now = new Date();
  let since = r.hours ? new Date(now.getTime() - r.hours * 3_600_000) : new Date(0);
  if (!r.hours) {
    const [first] = await rows<{ first: Date | null }>(sql`select min(started_at) as first from analytics_sessions`);
    since = first?.first ? new Date(first.first) : now;
  }
  const unit = r.unit;
  const fmt = unit === "day" ? "YYYY-MM-DD" : 'YYYY-MM-DD"T"HH24';
  const inRange = sql`started_at >= ${since}`;
  const seconds = sql`extract(epoch from last_seen_at - started_at)`;
  const ranked = (by: SQL, detail: SQL = sql`null`, limit = 12) =>
    rows<{ label: string; detail: string | null; visits: number; visitors: number }>(sql`
      select ${by} as label, ${detail} as detail, count(*)::int as visits, count(distinct visitor_id)::int as visitors
      from analytics_sessions where ${inRange} group by 1, 2 order by visits desc, label limit ${limit}`);

  const [[summary], [returning], [chats], [active], seriesRows, pages, regions, cities, sources, devices, browsers, recent] =
    await Promise.all([
      rows<{ visitors: number; visits: number; pageviews: number; avg: number; median: number; bounce: number }>(sql`
        select count(distinct visitor_id)::int as visitors, count(*)::int as visits,
          coalesce(sum(pageviews), 0)::int as pageviews,
          coalesce(avg(${seconds}), 0)::float as avg,
          coalesce(percentile_cont(0.5) within group (order by ${seconds}), 0)::float as median,
          coalesce(avg(case when pageviews <= 1 and last_seen_at - started_at < interval '10 seconds' then 1.0 else 0 end), 0)::float as bounce
        from analytics_sessions where ${inRange}`),
      // visitors in range whose first-ever visit was before it
      rows<{ n: number }>(sql`
        select count(*)::int as n from (
          select visitor_id from analytics_sessions group by visitor_id
          having max(started_at) >= ${since} and min(started_at) < ${since}) v`),
      rows<{ n: number }>(sql`select count(*)::int as n from analytics_events where type = 'chat' and at >= ${since}`),
      rows<{ n: number }>(sql`select count(*)::int as n from analytics_sessions where last_seen_at >= now() - interval '5 minutes'`),
      rows<{ key: string; visits: number; visitors: number }>(sql`
        select to_char(started_at at time zone ${TZ}, ${fmt}) as key, count(*)::int as visits,
          count(distinct visitor_id)::int as visitors
        from analytics_sessions where ${inRange} group by 1`),
      rows<{ label: string; visits: number; visitors: number }>(sql`
        select path as label, count(*)::int as visits, count(distinct visitor_id)::int as visitors
        from analytics_events where type = 'pageview' and at >= ${since}
        group by path order by visits desc, path limit 15`),
      ranked(sql`coalesce(region, 'Unknown')`, sql`coalesce(country, '')`),
      ranked(sql`coalesce(city, 'Unknown')`, sql`concat_ws(', ', region, country)`, 15),
      ranked(sql`coalesce(referrer, 'Direct / none')`),
      ranked(sql`coalesce(device, 'unknown')`),
      ranked(sql`coalesce(browser, 'Other')`, sql`coalesce(os, '')`),
      rows<{
        id: string;
        started_at: Date;
        seconds: number;
        pageviews: number;
        chats: number;
        entry_path: string | null;
        city: string | null;
        region: string | null;
        country: string | null;
        device: string | null;
        browser: string | null;
        referrer: string | null;
      }>(sql`
        select id, started_at, ${seconds}::float as seconds, pageviews, entry_path, city, region, country, device, browser, referrer,
          (select count(*)::int from analytics_events e where e.session_id = analytics_sessions.id and e.type = 'chat') as chats
        from analytics_sessions where ${inRange} order by started_at desc limit 30`),
    ]);

  const byKey = new Map(seriesRows.map((x) => [x.key, x]));
  const series = bucketKeys(since, now, unit).map((key) => ({
    key,
    label: bucketLabel(key, unit),
    visits: byKey.get(key)?.visits ?? 0,
    visitors: byKey.get(key)?.visitors ?? 0,
  }));
  const asRanked = (x: { label: string; detail?: string | null; visits: number; visitors: number }): Ranked => ({
    label: x.label,
    detail: x.detail || undefined,
    visits: x.visits,
    visitors: x.visitors,
  });

  return {
    range,
    since,
    visitors: summary.visitors,
    returningVisitors: returning.n,
    visits: summary.visits,
    pageviews: summary.pageviews,
    avgSeconds: summary.avg,
    medianSeconds: summary.median,
    bounceRate: summary.bounce,
    chats: chats.n,
    activeNow: active.n,
    series,
    unit,
    pages: pages.map(asRanked),
    regions: regions.map(asRanked),
    cities: cities.map(asRanked),
    sources: sources.map(asRanked),
    devices: devices.map(asRanked),
    browsers: browsers.map(asRanked),
    recent: recent.map((x) => ({
      id: x.id,
      startedAt: new Date(x.started_at),
      seconds: x.seconds,
      pageviews: x.pageviews,
      chats: x.chats,
      entryPath: x.entry_path,
      place: [x.city, x.region, x.country].filter(Boolean).join(", ") || "Unknown",
      device: x.device,
      browser: x.browser,
      referrer: x.referrer,
    })),
  };
}
