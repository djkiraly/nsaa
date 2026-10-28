import Anthropic from "@anthropic-ai/sdk";
import { NextRequest } from "next/server";
import { z } from "zod";
import { TOOL_DEFS, runTool } from "@/lib/agent/tools";
import { SEEDING_CUTOFF, SUPPORTED_CLASSES } from "@/lib/data/season";
import { assistantRecord, clip, logChatMessage, type ToolRun } from "@/lib/chat-log";

export const runtime = "nodejs";
export const maxDuration = 120;

const MODEL = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-5";

const SYSTEM = `You are the NSAA Volleyball Postseason Agent for the 2026 Nebraska high-school season.
You answer questions about seedings, district/sub-district assignments, brackets, likely matchups, host sites and
simulation-based probabilities for every class (${SUPPORTED_CLASSES.join(", ")}).

How you work:
- Always ground answers in tool results. Call get_standings / get_projected_brackets / simulate_postseason / team_outlook
  rather than guessing. For "who will X play" questions use team_outlook (likelyOpponentsByStage) and get_projected_brackets.
- Seeding is based on matches through ${SEEDING_CUTOFF}; NSAA publishes official pairings Thu Oct 22. get_projected_brackets
  says which applies (status): PROJECTED from wildcard averages, or OFFICIAL with NSAA's sites/times and any posted results.
  Posted results are fixed in the simulation. Say which applies briefly, once.
- Once results post (Oct 26 on), use get_postseason_status for who is eliminated, likely out, still alive for an
  at-large / wildcard spot, or qualified, and the loss that decided it (get_standings and team_outlook carry the same
  status). A district / sub-district loss alone doesn't eliminate anyone: A/B have the wildcard, C/D at-large
  district-final spots. "likely-out" means no simulation run gets them in but it isn't settled yet — say so.
- Formats differ by class: A/B serpentine 7 districts (7 champions + 1 wildcard to state); C1/C2 regions → 10
  sub-districts, D1/D2 NSAA-assigned 12 sub-districts (winners + best non-winners fill 16-team district finals Oct 31).
  Call get_rules when the details matter.
- Host sites: higher seed hosts (Class A always; Class B neutral sites > 300 mi before the final; C1/C2 #1 seed hosts,
  play-in exception; D1/D2 #1 seed hosts the whole sub-district; district finals hosted by the higher seed). After
  Oct 22 you can fetch_nsaa_bracket for the official site/time.
- Probabilities come from a Monte Carlo model (set-level Bradley-Terry with home court, fit on this season). Present them
  as approximate ("about 50%"), rounded to the nearest 5% unless asked for precision. Note when a result is close.
- Be concise and concrete. Use short tables or bullet lists for standings/brackets. Use team names exactly as NSAA prints them.
- Today's date: ${new Date().toISOString().slice(0, 10)}.`;

const id = z.string().regex(/^[\w-]{8,64}$/);
const Body = z.object({
  messages: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string() })).min(1),
  /** One per chat page load; ties the questions and answers of one conversation together in chat_messages. */
  conversationId: id.optional(),
  /** The analytics visit / visitor (components/analytics.tsx), absent when the browser is opted out of tracking. */
  sessionId: id.optional(),
  visitorId: id.optional(),
});

export async function POST(req: NextRequest) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return new Response(JSON.stringify({ error: "ANTHROPIC_API_KEY is not set" }), { status: 500 });
  }
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return new Response(JSON.stringify({ error: "Bad request" }), { status: 400 });
  const body = parsed.data;
  const client = new Anthropic();
  const messages: Anthropic.MessageParam[] = body.messages.slice(-20).map((m) => ({ role: m.role, content: m.content }));

  // Transcript: the question now, the answer (text, tool calls, tokens, timing) once the stream ends.
  const log = body.conversationId ? { conversationId: body.conversationId, sessionId: body.sessionId, visitorId: body.visitorId } : null;
  const question = body.messages[body.messages.length - 1];
  if (log && question.role === "user") void logChatMessage(log, "user", { text: question.content }, MODEL);
  const started = Date.now();
  const turns: Anthropic.Message[] = [];
  const toolRuns: ToolRun[] = [];

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
      let error: string | undefined;
      try {
        for (let turn = 0; turn < 8; turn++) {
          const s = client.messages.stream({
            model: MODEL,
            max_tokens: 2048,
            system: SYSTEM,
            tools: TOOL_DEFS,
            messages,
          });
          s.on("text", (delta) => send({ type: "text", delta }));
          const final = await s.finalMessage();
          turns.push(final);
          messages.push({ role: "assistant", content: final.content });
          const toolUses = final.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
          if (final.stop_reason !== "tool_use" || toolUses.length === 0) break;
          const results: Anthropic.ToolResultBlockParam[] = [];
          for (const tu of toolUses) {
            send({ type: "tool", name: tu.name, input: tu.input });
            const t0 = Date.now();
            let out: unknown;
            try {
              out = await runTool(tu.name, tu.input as Record<string, unknown>);
            } catch (e) {
              out = { error: e instanceof Error ? e.message : String(e) };
            }
            const json = JSON.stringify(out);
            toolRuns.push({ name: tu.name, input: tu.input, result: clip(json), ms: Date.now() - t0 });
            results.push({ type: "tool_result", tool_use_id: tu.id, content: json });
          }
          messages.push({ role: "user", content: results });
        }
        send({ type: "done" });
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
        send({ type: "error", message: error });
      } finally {
        controller.close();
        if (log) void logChatMessage(log, "assistant", assistantRecord(turns, toolRuns, Date.now() - started, error), MODEL);
      }
    },
  });
  return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8" } });
}
