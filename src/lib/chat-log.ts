/**
 * Chat transcripts for the private /analytics pages: what each question and answer looks like in chat_messages,
 * and the writer the chat route calls. Logging never fails a chat — errors are warned and dropped.
 */
import type Anthropic from "@anthropic-ai/sdk";
import { db, schema } from "./db";

/** One tool call the agent made while answering. */
export interface ToolRun {
  name: string;
  input: unknown;
  /** The tool's JSON result, clipped to RESULT_MAX characters. */
  result: string;
  ms: number;
}

export interface UserRecord {
  text: string;
}

export interface AssistantRecord {
  text: string;
  tools: ToolRun[];
  /** Tokens summed over every model turn of this answer. */
  usage: { input: number; output: number };
  /** Model turns (1 + one per round of tool calls). */
  turns: number;
  ms: number;
  error?: string;
}

export const RESULT_MAX = 4000;

/** `s` cut to `max` characters with a note of how much was dropped. */
export function clip(s: string, max = RESULT_MAX): string {
  return s.length > max ? `${s.slice(0, max)}… [${(s.length - max).toLocaleString("en-US")} more characters]` : s;
}

/** The answer's record from the model's turns and the tool calls made along the way. */
export function assistantRecord(turns: Anthropic.Message[], tools: ToolRun[], ms: number, error?: string): AssistantRecord {
  const text = turns
    .flatMap((t) => t.content)
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  const usage = turns.reduce(
    (u, t) => ({ input: u.input + (t.usage?.input_tokens ?? 0), output: u.output + (t.usage?.output_tokens ?? 0) }),
    { input: 0, output: 0 },
  );
  return { text, tools, usage, turns: turns.length, ms: Math.round(ms), ...(error ? { error } : {}) };
}

export interface ChatLogIds {
  conversationId: string;
  sessionId?: string;
  visitorId?: string;
}

export async function logChatMessage(ids: ChatLogIds, role: "user" | "assistant", content: UserRecord | AssistantRecord, model?: string) {
  if (!db) return;
  try {
    await db.insert(schema.chatMessages).values({
      conversationId: ids.conversationId,
      sessionId: ids.sessionId ?? null,
      visitorId: ids.visitorId ?? null,
      role,
      content,
      model: model ?? null,
    });
  } catch (e) {
    console.warn(`[chat-log] ${e instanceof Error ? e.message : e}`);
  }
}

/** A stored row's content as the page shows it (tolerates rows written by other versions). */
export function readRecord(role: string, content: unknown): UserRecord | AssistantRecord {
  const c = (content && typeof content === "object" ? content : {}) as Record<string, unknown>;
  const text = typeof c.text === "string" ? c.text : typeof content === "string" ? content : "";
  if (role === "user") return { text };
  const usage = (c.usage && typeof c.usage === "object" ? c.usage : {}) as Record<string, unknown>;
  const tools = Array.isArray(c.tools)
    ? c.tools.map((t) => {
        const x = (t && typeof t === "object" ? t : {}) as Record<string, unknown>;
        return { name: String(x.name ?? "?"), input: x.input, result: typeof x.result === "string" ? x.result : "", ms: Number(x.ms) || 0 };
      })
    : [];
  return {
    text,
    tools,
    usage: { input: Number(usage.input) || 0, output: Number(usage.output) || 0 },
    turns: Number(c.turns) || 0,
    ms: Number(c.ms) || 0,
    ...(typeof c.error === "string" ? { error: c.error } : {}),
  };
}
