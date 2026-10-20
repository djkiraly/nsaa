import Anthropic from "@anthropic-ai/sdk";
import { NextRequest } from "next/server";
import { TOOL_DEFS, runTool } from "@/lib/agent/tools";
import { SEEDING_CUTOFF, SUPPORTED_CLASSES } from "@/lib/data/season";

export const runtime = "nodejs";
export const maxDuration = 120;

const MODEL = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-5";

const SYSTEM = `You are the NSAA Volleyball Postseason Agent for the 2026 Nebraska high-school season.
You answer questions about seedings, district/sub-district assignments, brackets, likely matchups, host sites and
simulation-based probabilities for Class B and Class C2 (classes supported: ${SUPPORTED_CLASSES.join(", ")}).

How you work:
- Always ground answers in tool results. Call get_standings / get_projected_brackets / simulate_postseason / team_outlook
  rather than guessing. For "who will X play" questions use team_outlook (likelyOpponentsByStage) and get_projected_brackets.
- Seeding is based on matches through ${SEEDING_CUTOFF}; NSAA publishes official pairings Thu Oct 22. Until then everything
  is a projection from current wildcard averages. Say so briefly when relevant, once — don't repeat caveats.
- Host sites: use the rules (higher seed hosts; Class B neutral sites > 300 mi; C2 #1 seed hosts; district finals hosted by
  higher seed). After Oct 22 you can fetch_nsaa_bracket for the official site/time.
- Probabilities come from a Monte Carlo model (set-level Bradley-Terry with home court, fit on this season). Present them
  as approximate ("about 50%"), rounded to the nearest 5% unless asked for precision. Note when a result is close.
- Be concise and concrete. Use short tables or bullet lists for standings/brackets. Use team names exactly as NSAA prints them.
- If asked about a class you don't support, say so.
- Today's date: ${new Date().toISOString().slice(0, 10)}.`;

interface ChatBody {
  messages: { role: "user" | "assistant"; content: string }[];
}

export async function POST(req: NextRequest) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return new Response(JSON.stringify({ error: "ANTHROPIC_API_KEY is not set" }), { status: 500 });
  }
  const body = (await req.json()) as ChatBody;
  const client = new Anthropic();
  const messages: Anthropic.MessageParam[] = body.messages.slice(-20).map((m) => ({ role: m.role, content: m.content }));

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
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
          messages.push({ role: "assistant", content: final.content });
          const toolUses = final.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
          if (final.stop_reason !== "tool_use" || toolUses.length === 0) break;
          const results: Anthropic.ToolResultBlockParam[] = [];
          for (const tu of toolUses) {
            send({ type: "tool", name: tu.name, input: tu.input });
            let out: unknown;
            try {
              out = await runTool(tu.name, tu.input as Record<string, unknown>);
            } catch (e) {
              out = { error: e instanceof Error ? e.message : String(e) };
            }
            results.push({ type: "tool_result", tool_use_id: tu.id, content: JSON.stringify(out) });
          }
          messages.push({ role: "user", content: results });
        }
        send({ type: "done" });
      } catch (e) {
        send({ type: "error", message: e instanceof Error ? e.message : String(e) });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8" } });
}
