import type { Metadata } from "next";
import Link from "next/link";
import { Card, CardContent, Table, Td, Th } from "@/components/ui";
import { listVisits, sinceFor } from "@/lib/analytics/chats";
import { duration, fmtTime, num, requireAnalyticsCookie } from "@/lib/analytics/shared";
import { db } from "@/lib/db";
import { AnalyticsNav, rangeFrom } from "../nav";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function VisitsPage({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  await requireAnalyticsCookie();
  const range = rangeFrom((await searchParams).range);
  if (!db) return <p className="text-sm text-muted">Analytics needs a database: set DATABASE_URL.</p>;
  const visits = await listVisits(sinceFor(range), 300);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Visits</h1>
        <p className="text-sm text-muted">
          Each visit newest first{visits.length === 300 ? " (the latest 300)" : ""}; open one for its page-by-page history and any
          conversations. Times are Central.
        </p>
      </div>
      <AnalyticsNav current="/analytics/sessions" range={range} />
      <Card>
        <CardContent className="pt-4">
          {visits.length === 0 ? (
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
                {visits.map((v) => (
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
                    <Td className="text-right">{v.chats ? num(v.chats) : <span className="text-muted">—</span>}</Td>
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
    </div>
  );
}
