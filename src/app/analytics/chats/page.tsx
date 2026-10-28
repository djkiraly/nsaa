import type { Metadata } from "next";
import Link from "next/link";
import { Card, CardContent, Table, Td, Th } from "@/components/ui";
import { listConversations, sinceFor } from "@/lib/analytics/chats";
import { fmtTime, num, requireAnalyticsCookie, shortId } from "@/lib/analytics/shared";
import { db } from "@/lib/db";
import { AnalyticsNav, rangeFrom } from "../nav";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function ConversationsPage({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  await requireAnalyticsCookie();
  const range = rangeFrom((await searchParams).range);
  if (!db) return <p className="text-sm text-muted">Analytics needs a database: set DATABASE_URL.</p>;
  const convos = await listConversations(sinceFor(range), 200);
  const questions = convos.reduce((n, c) => n + c.questions, 0);
  const tokens = convos.reduce((n, c) => n + c.inputTokens + c.outputTokens, 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Conversations</h1>
        <p className="text-sm text-muted">
          Every chat with the agent, newest first. {num(convos.length)} conversation{convos.length === 1 ? "" : "s"}, {num(questions)}{" "}
          question{questions === 1 ? "" : "s"}, {num(tokens)} tokens. Times are Central.
        </p>
      </div>
      <AnalyticsNav current="/analytics/chats" range={range} />
      <Card>
        <CardContent className="pt-4">
          {convos.length === 0 ? (
            <p className="text-sm text-muted">No conversations in this range yet.</p>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Started</Th>
                  <Th>First question</Th>
                  <Th className="text-right">Questions</Th>
                  <Th className="text-right">Tokens</Th>
                  <Th>Visit</Th>
                </tr>
              </thead>
              <tbody>
                {convos.map((c) => (
                  <tr key={c.id} className="hover:bg-muted-bg/60">
                    <Td className="whitespace-nowrap tabular">
                      <Link href={`/analytics/chats/${c.id}`} prefetch={false} className="text-accent hover:underline">
                        {fmtTime(c.startedAt)}
                      </Link>
                    </Td>
                    <Td className="max-w-[32rem]">
                      <Link href={`/analytics/chats/${c.id}`} prefetch={false} className="line-clamp-2 hover:underline">
                        {c.firstQuestion || <span className="text-muted">(empty)</span>}
                      </Link>
                      {c.hadError && <span className="ml-1 text-xs text-accent">error</span>}
                    </Td>
                    <Td className="text-right tabular">{c.questions}</Td>
                    <Td className="text-right tabular">{num(c.inputTokens + c.outputTokens)}</Td>
                    <Td className="whitespace-nowrap text-muted">
                      {c.sessionId ? (
                        <Link href={`/analytics/sessions/${c.sessionId}`} prefetch={false} className="hover:underline">
                          {c.place} · {c.device ?? "—"}
                        </Link>
                      ) : (
                        <span title="The browser opted out of tracking">not tracked · {shortId(c.id)}</span>
                      )}
                    </Td>
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
