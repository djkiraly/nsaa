import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Card, CardContent, CardHeader, CardTitle, Table, Td, Th } from "@/components/ui";
import { getVisit } from "@/lib/analytics/chats";
import { duration, fmtTime, fmtTimeSec, num, requireAnalyticsCookie, shortId } from "@/lib/analytics/shared";
import { db } from "@/lib/db";
import { AnalyticsNav } from "../../nav";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

const ID = /^[\w-]{8,64}$/;

export default async function VisitPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAnalyticsCookie();
  const { id } = await params;
  if (!ID.test(id)) notFound();
  if (!db) return <p className="text-sm text-muted">Analytics needs a database: set DATABASE_URL.</p>;
  const d = await getVisit(id);
  if (!d) notFound();
  const { visit: v } = d;
  const facts: [string, string][] = [
    ["Started", fmtTime(v.startedAt)],
    ["Last seen", fmtTime(v.lastSeenAt)],
    ["Length", duration(v.seconds)],
    ["Location", v.place],
    ["Device", [v.device, v.browser, v.os].filter(Boolean).join(" · ") || "—"],
    ["Landed on", v.entryPath ?? "—"],
    ["Source", v.referrer ?? "Direct / none"],
    ["Visitor", `${shortId(v.visitorId)} · ${num(d.otherVisits.length + 1)} visit${d.otherVisits.length ? "s" : ""}`],
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Visit</h1>
        <p className="text-sm text-muted">
          {v.pageviews} page view{v.pageviews === 1 ? "" : "s"} and {v.chats} chat question{v.chats === 1 ? "" : "s"} over{" "}
          {duration(v.seconds)}. Times are Central.
        </p>
      </div>
      <AnalyticsNav current="/analytics/sessions" />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {facts.map(([label, value]) => (
          <Card key={label}>
            <CardContent className="pt-3 pb-3">
              <div className="text-xs text-muted">{label}</div>
              <div className="text-sm font-medium [overflow-wrap:anywhere]">{value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>History</CardTitle>
        </CardHeader>
        <CardContent>
          {d.events.length === 0 ? (
            <p className="text-sm text-muted">No events recorded.</p>
          ) : (
            <ol className="text-sm space-y-1">
              {d.events.map((e, i) => (
                <li key={i} className="flex items-baseline gap-3">
                  <span className="tabular text-muted whitespace-nowrap w-40 shrink-0">{fmtTimeSec(e.at)}</span>
                  <Badge variant={e.type === "chat" ? "accent" : "outline"}>{e.type === "chat" ? "chat" : "page"}</Badge>
                  <span className="[overflow-wrap:anywhere]">{e.path}</span>
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Conversations</CardTitle>
        </CardHeader>
        <CardContent>
          {d.conversations.length === 0 ? (
            <p className="text-sm text-muted">
              {v.chats
                ? "Questions were asked, but no transcript is stored for this visit (older than transcript logging, or the chat was opened before tracking started)."
                : "No chat during this visit."}
            </p>
          ) : (
            <ul className="text-sm space-y-2">
              {d.conversations.map((c) => (
                <li key={c.id}>
                  <Link href={`/analytics/chats/${c.id}`} prefetch={false} className="hover:underline">
                    <span className="tabular text-muted">{fmtTime(c.startedAt)}</span> · {c.questions} question{c.questions === 1 ? "" : "s"} ·{" "}
                    <span className="line-clamp-1 inline">{c.firstQuestion || "(empty)"}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {d.otherVisits.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Same visitor, other visits</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <thead>
                <tr>
                  <Th>Started</Th>
                  <Th className="text-right">Pages</Th>
                  <Th className="text-right">Chats</Th>
                  <Th className="text-right">Length</Th>
                  <Th>Landed on</Th>
                </tr>
              </thead>
              <tbody className="tabular">
                {d.otherVisits.map((o) => (
                  <tr key={o.id}>
                    <Td className="whitespace-nowrap">
                      <Link href={`/analytics/sessions/${o.id}`} prefetch={false} className="text-accent hover:underline">
                        {fmtTime(o.startedAt)}
                      </Link>
                    </Td>
                    <Td className="text-right">{o.pageviews}</Td>
                    <Td className="text-right">{o.chats || "—"}</Td>
                    <Td className="text-right">{duration(o.seconds)}</Td>
                    <Td>{o.entryPath ?? "—"}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
