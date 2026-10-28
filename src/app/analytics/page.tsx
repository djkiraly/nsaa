import type { Metadata } from "next";
import Link from "next/link";
import { existsSync } from "node:fs";
import { Card, CardContent, CardHeader, CardTitle, Table, Td, Th } from "@/components/ui";
import { VisitsChart } from "@/components/visits-chart";
import { listConversations, sinceFor } from "@/lib/analytics/chats";
import { GEOIP_PATH } from "@/lib/analytics/geo";
import { getDashboard, TZ, type Ranked } from "@/lib/analytics/queries";
import { duration, fmtTime, num, requireAnalyticsCookie } from "@/lib/analytics/shared";
import { db } from "@/lib/db";
import { AnalyticsNav, rangeFrom } from "./nav";

// Private usage dashboard. Not linked anywhere; proxy.ts answers with the site's normal 404 unless the visitor has
// the access cookie (set when /analytics?key=<ANALYTICS_KEY> is opened once).
export const dynamic = "force-dynamic";
// No title of its own: a 404 for this URL must look exactly like one for any URL that doesn't exist.
export const metadata: Metadata = { robots: { index: false, follow: false } };

const pct = (x: number) => `${Math.round(100 * x)}%`;

export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  await requireAnalyticsCookie();
  const range = rangeFrom((await searchParams).range);
  if (!db) return <p className="text-sm text-muted">Analytics needs a database: set DATABASE_URL.</p>;
  const [d, convos] = await Promise.all([getDashboard(range), listConversations(sinceFor(range), 15)]);

  const tiles: { label: string; value: string; sub?: string }[] = [
    { label: "Visitors", value: num(d.visitors), sub: d.visitors ? `${pct(d.returningVisitors / d.visitors)} returning` : undefined },
    { label: "Visits", value: num(d.visits), sub: d.visits ? `${(d.pageviews / d.visits).toFixed(1)} pages per visit` : undefined },
    { label: "Page views", value: num(d.pageviews) },
    { label: "Average visit", value: duration(d.avgSeconds), sub: `median ${duration(d.medianSeconds)}` },
    { label: "Bounce rate", value: pct(d.bounceRate), sub: "one page, under 10 s" },
    { label: "Chat questions", value: num(d.chats) },
    { label: "On the site now", value: num(d.activeNow), sub: "active in the last 5 min" },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Analytics</h1>
        <p className="text-sm text-muted">
          Private — not linked anywhere. Times are Central. Since{" "}
          {d.since.toLocaleString("en-US", { timeZone: TZ, dateStyle: "medium", timeStyle: "short" })}.
        </p>
      </div>

      {/* Section links and the filter row, above everything they scope. */}
      <AnalyticsNav current="/analytics" range={range} />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
        {tiles.map((t) => (
          <Card key={t.label}>
            <CardContent className="pt-3 pb-3">
              <div className="text-xs text-muted">{t.label}</div>
              <div className="text-2xl font-semibold leading-tight">{t.value}</div>
              {t.sub && <div className="text-[11px] text-muted">{t.sub}</div>}
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Visits per {d.unit}</CardTitle>
        </CardHeader>
        <CardContent>
          <VisitsChart points={d.series} />
        </CardContent>
      </Card>

      {!existsSync(GEOIP_PATH) && (
        <p className="text-sm text-muted rounded-md border border-border bg-card px-3 py-2">
          Locations show as unknown until the IP-location database is downloaded: run <code>npm run geoip</code> on the
          server (deploy/install.sh does this).
        </p>
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <RankedCard title="Pages" rows={d.pages} unit="views" />
        <RankedCard title="States / regions" rows={d.regions} unit="visits" />
        <RankedCard title="Cities" rows={d.cities} unit="visits" />
        <RankedCard title="Sources" rows={d.sources} unit="visits" />
        <RankedCard title="Devices" rows={d.devices} unit="visits" />
        <RankedCard title="Browsers" rows={d.browsers} unit="visits" />
      </div>

      <Card>
        <CardHeader className="flex items-center justify-between">
          <CardTitle>Recent conversations</CardTitle>
          <Link href={`/analytics/chats${range !== "7d" ? `?range=${range}` : ""}`} prefetch={false} className="text-sm text-accent hover:underline">
            All conversations →
          </Link>
        </CardHeader>
        <CardContent>
          {convos.length === 0 ? (
            <p className="text-sm text-muted">No conversations in this range yet.</p>
          ) : (
            <ul className="text-sm space-y-2">
              {convos.map((c) => (
                <li key={c.id} className="flex items-baseline gap-3">
                  <Link href={`/analytics/chats/${c.id}`} prefetch={false} className="tabular whitespace-nowrap text-accent hover:underline">
                    {fmtTime(c.startedAt)}
                  </Link>
                  <Link href={`/analytics/chats/${c.id}`} prefetch={false} className="min-w-0 flex-1 line-clamp-1 hover:underline">
                    {c.firstQuestion || "(empty)"}
                  </Link>
                  <span className="shrink-0 text-xs text-muted whitespace-nowrap">
                    {c.questions} q · {c.place ?? "not tracked"}
                    {c.hadError && <span className="text-accent"> · error</span>}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex items-center justify-between">
          <CardTitle>Recent visits</CardTitle>
          <Link href={`/analytics/sessions${range !== "7d" ? `?range=${range}` : ""}`} prefetch={false} className="text-sm text-accent hover:underline">
            All visits →
          </Link>
        </CardHeader>
        <CardContent>
          {d.recent.length === 0 ? (
            <p className="text-sm text-muted">No visits in this range yet.</p>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Started</Th>
                  <Th>Location</Th>
                  <Th>Device</Th>
                  <Th className="text-right">Pages</Th>
                  <Th className="text-right">Chats</Th>
                  <Th className="text-right">Length</Th>
                  <Th>Landed on</Th>
                  <Th>Source</Th>
                </tr>
              </thead>
              <tbody className="tabular">
                {d.recent.map((v) => (
                  <tr key={v.id} className="hover:bg-muted-bg/60">
                    <Td className="whitespace-nowrap">
                      <Link href={`/analytics/sessions/${v.id}`} prefetch={false} className="text-accent hover:underline">
                        {fmtTime(v.startedAt)}
                      </Link>
                    </Td>
                    <Td>{v.place}</Td>
                    <Td className="whitespace-nowrap">
                      {v.device ?? "—"} · {v.browser ?? "—"}
                    </Td>
                    <Td className="text-right">{v.pageviews}</Td>
                    <Td className="text-right">{v.chats || <span className="text-muted">—</span>}</Td>
                    <Td className="text-right">{duration(v.seconds)}</Td>
                    <Td>{v.entryPath ?? "—"}</Td>
                    <Td>{v.referrer ?? "Direct / none"}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </CardContent>
      </Card>

      <p className="text-xs text-muted">
        Visitors are counted by a random id in the browser; no IP addresses are stored. Browsers that send Global
        Privacy Control or Do Not Track aren&apos;t counted, and their chats aren&apos;t tied to a visit. Chat questions
        and the agent&apos;s answers are stored (Conversations) to improve the agent. IP geolocation by{" "}
        <a href="https://db-ip.com" rel="noreferrer" target="_blank" className="underline">
          DB-IP
        </a>{" "}
        (CC BY 4.0).
      </p>
    </div>
  );
}

/** A ranked list with a thin magnitude bar per row (one hue, length = share of the top row). */
function RankedCard({ title, rows, unit }: { title: string; rows: Ranked[]; unit: string }) {
  const max = Math.max(1, ...rows.map((r) => r.visits));
  return (
    <Card>
      <CardHeader className="flex items-center justify-between">
        <CardTitle>{title}</CardTitle>
        <span className="text-xs text-muted">{unit}</span>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-muted">Nothing yet.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {rows.map((r) => (
              <li key={`${r.label}|${r.detail ?? ""}`}>
                <div className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 truncate">
                    {r.label}
                    {r.detail && <span className="text-xs text-muted"> · {r.detail}</span>}
                  </span>
                  <span className="shrink-0 tabular text-muted">{num(r.visits)}</span>
                </div>
                <div className="mt-1 h-1 rounded-full bg-muted-bg">
                  <div className="h-full rounded-full bg-chart" style={{ width: `${(100 * r.visits) / max}%` }} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
