import { describe, expect, it } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { assistantRecord, clip, readRecord, RESULT_MAX } from "../src/lib/chat-log";

const turn = (content: unknown[], input = 100, output = 50): Anthropic.Message =>
  ({ id: "m", type: "message", role: "assistant", model: "x", content, stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: input, output_tokens: output } }) as unknown as Anthropic.Message;

describe("chat transcript records", () => {
  it("joins the text of every turn, sums tokens and keeps the tool calls", () => {
    const tools = [{ name: "get_standings", input: { vbClass: "B" }, result: '{"ok":true}', ms: 12 }];
    const r = assistantRecord(
      [
        turn([{ type: "text", text: "Let me look. " }, { type: "tool_use", id: "t", name: "get_standings", input: { vbClass: "B" } }], 100, 20),
        turn([{ type: "text", text: "Norris is #1." }], 400, 80),
      ],
      tools,
      1234.6,
    );
    expect(r).toEqual({ text: "Let me look. Norris is #1.", tools, usage: { input: 500, output: 100 }, turns: 2, ms: 1235 });
  });
  it("records an error with whatever was produced before it", () => {
    const r = assistantRecord([], [], 5, "overloaded");
    expect(r).toMatchObject({ text: "", turns: 0, error: "overloaded", usage: { input: 0, output: 0 } });
  });
  it("clips long tool results and says how much was cut", () => {
    const long = "x".repeat(RESULT_MAX + 1500);
    expect(clip(long)).toHaveLength(RESULT_MAX + "… [1,500 more characters]".length);
    expect(clip(long).endsWith("… [1,500 more characters]")).toBe(true);
    expect(clip("short")).toBe("short");
  });
  it("reads stored rows defensively", () => {
    expect(readRecord("user", { text: "hi" })).toEqual({ text: "hi" });
    expect(readRecord("user", "plain")).toEqual({ text: "plain" });
    expect(readRecord("user", null)).toEqual({ text: "" });
    expect(readRecord("assistant", { text: "a", tools: [{ name: "x", input: 1, result: "r", ms: "3" }, null], usage: { input: "7" }, error: "e" })).toEqual({
      text: "a",
      tools: [
        { name: "x", input: 1, result: "r", ms: 3 },
        { name: "?", input: undefined, result: "", ms: 0 },
      ],
      usage: { input: 7, output: 0 },
      turns: 0,
      ms: 0,
      error: "e",
    });
  });
});
