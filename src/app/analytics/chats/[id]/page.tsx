import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Card, CardContent, cn } from "@/components/ui";
import { getConversation } from "@/lib/analytics/chats";
import { duration, fmtTime, fmtTimeSec, num, requireAnalyticsCookie, shortId } from "@/lib/analytics/shared";
import type { AssistantRecord } from "@/lib/chat-log";
import { db } from "@/lib/db";
import { AnalyticsNav } from "../../nav";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

const ID = /^[\w-]{8,64}$/;

export default async function ConversationPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAnalyticsCookie();
  const { id } = await params;
  if (!ID.test(id)) notFound();
  if (!db) return <p className="text-sm text-muted">Analytics needs a database: set DATABASE_URL.</p>;
  const c = await getConversation(id);
  if (!c) notFound();
  const answers = c.messages.filter((m) => m.role === "assistant").map((m) => m.record as AssistantRecord);
  const tokens = answers.reduce((n, a) => n + a.usage.input + a.usage.output, 0);
  const model = c.messages.find((m) => m.model)?.model;
  const first = c.messages[0].createdAt;
  const last = c.messages[c.messages.length - 1].createdAt;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Conversation</h1>
        <p className="text-sm text-muted">
          {fmtTime(first)}
          {last.getTime() - first.getTime() > 60_000 && ` – ${fmtTime(last)}`} · {c.messages.filter((m) => m.role === "user").length} question
          {c.messages.filter((m) => m.role === "user").length === 1 ? "" : "s"} · {num(tokens)} tokens{model && ` · ${model}`}
        </p>
        <p className="text-sm text-muted">
          {c.visit ? (
            <>
              Visit:{" "}
              <Link href={`/analytics/sessions/${c.visit.id}`} prefetch={false} className="text-accent hover:underline">
                {c.visit.place} · {c.visit.device ?? "—"} · {c.visit.browser ?? "—"} · {fmtTime(c.visit.startedAt)}
              </Link>
            </>
          ) : (
            <>Not tied to a visit (the browser opted out of tracking) · {shortId(c.id)}</>
          )}
        </p>
      </div>
      <AnalyticsNav current="/analytics/chats" />

      <div className="space-y-4">
        {c.messages.map((m) => (
          <div key={m.id} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
            <div
              className={cn(
                "max-w-[85%] rounded-lg px-4 py-3 text-sm max-md:max-w-[95%]",
                m.role === "user" ? "bg-foreground text-background" : "bg-card border border-border",
              )}
            >
              <div className={cn("text-[11px] mb-1", m.role === "user" ? "text-background/70" : "text-muted")}>
                {m.role === "user" ? "Visitor" : "Agent"} · {fmtTimeSec(m.createdAt)}
                {m.role === "assistant" && <AnswerMeta a={m.record as AssistantRecord} />}
              </div>
              {m.role === "assistant" && <Tools a={m.record as AssistantRecord} />}
              <div className="whitespace-pre-wrap [overflow-wrap:anywhere]">{m.record.text || <span className="text-muted">(no text)</span>}</div>
              {m.role === "assistant" && (m.record as AssistantRecord).error && (
                <div className="mt-2 text-accent">Error: {(m.record as AssistantRecord).error}</div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function AnswerMeta({ a }: { a: AssistantRecord }) {
  return (
    <>
      {" "}
      · {duration(a.ms / 1000)} · {num(a.usage.input)} in / {num(a.usage.output)} out
      {a.turns > 1 && ` · ${a.turns} turns`}
    </>
  );
}

/** The tool calls behind an answer: name and input up front, the result on demand. */
function Tools({ a }: { a: AssistantRecord }) {
  if (a.tools.length === 0) return null;
  return (
    <Card className="mb-3 bg-muted-bg/50">
      <CardContent className="pt-2 pb-2 space-y-1">
        {a.tools.map((t, i) => (
          <details key={i} className="text-xs">
            <summary className="cursor-pointer">
              <Badge className="font-mono">{t.name}</Badge>{" "}
              <span className="font-mono text-muted [overflow-wrap:anywhere]">{JSON.stringify(t.input)}</span>
              <span className="text-muted"> · {duration(t.ms / 1000)}</span>
            </summary>
            <pre className="mt-1 max-h-72 overflow-auto rounded bg-card border border-border p-2 text-[11px] whitespace-pre-wrap [overflow-wrap:anywhere]">
              {pretty(t.result)}
            </pre>
          </details>
        ))}
      </CardContent>
    </Card>
  );
}

function pretty(json: string): string {
  try {
    return JSON.stringify(JSON.parse(json), null, 2);
  } catch {
    return json; // clipped results aren't valid JSON any more
  }
}
