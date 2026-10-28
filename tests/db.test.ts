/**
 * The analytics / transcript SQL against a real Postgres (PGlite, in-process): migrations apply, and every query the
 * /analytics pages run returns what the pages expect. `src/lib/db` is swapped for a PGlite-backed drizzle instance.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/pglite/migrator";
import type { PgliteDatabase } from "drizzle-orm/pglite";

vi.mock("../src/lib/db", async () => {
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const schema = await import("../src/lib/db/schema");
  const db = drizzle(new PGlite(), { schema });
  return { db, schema, hasDb: true };
});

import { db, schema } from "../src/lib/db";
import { logChatMessage } from "../src/lib/chat-log";
import { getConversation, getVisit, listConversations, listVisits, sinceFor } from "../src/lib/analytics/chats";
import { getDashboard } from "../src/lib/analytics/queries";

const pg = db as unknown as PgliteDatabase<typeof schema>;
const VISIT = "visit-aaaaaaaa";
const VISITOR = "visitor-bbbbbbbb";
const CONVO = "convo-cccccccc";
const CONVO_UNTRACKED = "convo-dddddddd";

beforeAll(async () => {
  await migrate(pg, { migrationsFolder: "drizzle" });
  await pg.insert(schema.analyticsSessions).values({
    id: VISIT,
    visitorId: VISITOR,
    startedAt: new Date("2026-10-28T20:00:00Z"),
    lastSeenAt: new Date("2026-10-28T20:05:00Z"),
    pageviews: 2,
    entryPath: "/class/B",
    city: "Gering",
    region: "Nebraska",
    country: "United States",
    device: "mobile",
    browser: "Safari",
    os: "iOS",
  });
  await pg.insert(schema.analyticsSessions).values({ id: "visit-eeeeeeee", visitorId: VISITOR, startedAt: new Date("2026-10-27T20:00:00Z"), pageviews: 1 });
  await pg.insert(schema.analyticsEvents).values([
    { sessionId: VISIT, visitorId: VISITOR, type: "pageview", path: "/class/B", at: new Date("2026-10-28T20:00:00Z") },
    { sessionId: VISIT, visitorId: VISITOR, type: "pageview", path: "/chat", at: new Date("2026-10-28T20:01:00Z") },
    { sessionId: VISIT, visitorId: VISITOR, type: "chat", path: "/chat", at: new Date("2026-10-28T20:02:00Z") },
  ]);
  const ids = { conversationId: CONVO, sessionId: VISIT, visitorId: VISITOR };
  await logChatMessage(ids, "user", { text: "Who hosts the B-5 final?" }, "claude-test");
  await logChatMessage(
    ids,
    "assistant",
    {
      text: "Gering hosts.",
      tools: [{ name: "get_projected_brackets", input: { vbClass: "B", groupId: "B-5" }, result: '{"ok":true}', ms: 40 }],
      usage: { input: 1200, output: 80 },
      turns: 2,
      ms: 3100,
    },
    "claude-test",
  );
  await logChatMessage(ids, "user", { text: "And the odds?" }, "claude-test");
  await logChatMessage(ids, "assistant", { text: "", tools: [], usage: { input: 300, output: 0 }, turns: 0, ms: 50, error: "overloaded" }, "claude-test");
  // A browser that opted out of tracking: no visit or visitor ids.
  await logChatMessage({ conversationId: CONVO_UNTRACKED }, "user", { text: "Hi" }, "claude-test");
  await logChatMessage({ conversationId: CONVO_UNTRACKED }, "assistant", { text: "Hello", tools: [], usage: { input: 10, output: 5 }, turns: 1, ms: 900 }, "claude-test");
});

describe("chat_messages after the migration", () => {
  it("has the transcript columns and indexes", async () => {
    const cols = (await pg.execute(sql`select column_name from information_schema.columns where table_name = 'chat_messages' order by 1`)).rows.map((r) => r.column_name);
    expect(cols).toEqual(["content", "conversation_id", "created_at", "id", "model", "role", "session_id", "visitor_id"]);
    const idx = (await pg.execute(sql`select indexname from pg_indexes where tablename = 'chat_messages' order by 1`)).rows.map((r) => r.indexname);
    expect(idx).toContain("chat_messages_conversation");
  });
});

describe("conversation queries", () => {
  it("lists conversations newest first with their first question, counts, tokens and visit", async () => {
    const list = await listConversations(new Date(0));
    expect(list.map((c) => c.id)).toEqual([CONVO_UNTRACKED, CONVO]);
    const c = list[1];
    expect(c).toMatchObject({
      questions: 2,
      firstQuestion: "Who hosts the B-5 final?",
      sessionId: VISIT,
      visitorId: VISITOR,
      inputTokens: 1500,
      outputTokens: 80,
      hadError: true,
      place: "Gering, Nebraska, United States",
      device: "mobile",
    });
    expect(list[0]).toMatchObject({ questions: 1, sessionId: null, place: null, hadError: false, inputTokens: 10, outputTokens: 5 });
    expect(await listConversations(new Date(Date.now() + 60_000))).toEqual([]);
  });
  it("returns a conversation's messages in order with the visit they belong to", async () => {
    const c = (await getConversation(CONVO))!;
    expect(c.messages.map((m) => m.role)).toEqual(["user", "assistant", "user", "assistant"]);
    expect(c.messages[1].record).toMatchObject({ text: "Gering hosts.", usage: { input: 1200, output: 80 }, turns: 2 });
    expect(c.messages[1].record).toHaveProperty("tools.0.name", "get_projected_brackets");
    expect(c.messages[3].record).toMatchObject({ error: "overloaded" });
    expect(c.messages[0].model).toBe("claude-test");
    expect(c.visit).toMatchObject({ id: VISIT, place: "Gering, Nebraska, United States", chats: 1, pageviews: 2 });
    expect(c.visitorId).toBe(VISITOR);
    expect((await getConversation(CONVO_UNTRACKED))!.visit).toBeNull();
    expect(await getConversation("nope-nope-nope")).toBeNull();
  });
});

describe("visit queries", () => {
  it("lists visits with their chat counts", async () => {
    const visits = await listVisits(new Date(0));
    expect(visits.map((v) => [v.id, v.chats, v.pageviews])).toEqual([
      [VISIT, 1, 2],
      ["visit-eeeeeeee", 0, 1],
    ]);
    expect(visits[0]).toMatchObject({ seconds: 300, entryPath: "/class/B", device: "mobile", browser: "Safari", os: "iOS" });
    expect(await listVisits(sinceFor("24h", new Date("2026-10-28T21:00:00Z")))).toHaveLength(1);
  });
  it("shows one visit's history, conversations and the visitor's other visits", async () => {
    const d = (await getVisit(VISIT))!;
    expect(d.events.map((e) => `${e.type} ${e.path}`)).toEqual(["pageview /class/B", "pageview /chat", "chat /chat"]);
    expect(d.conversations.map((c) => c.id)).toEqual([CONVO]);
    expect(d.otherVisits.map((v) => v.id)).toEqual(["visit-eeeeeeee"]);
    expect(await getVisit("nope-nope-nope")).toBeNull();
  });
  it("the dashboard's recent visits carry ids and chat counts", async () => {
    const dash = await getDashboard("all");
    expect(dash.chats).toBe(1);
    expect(dash.visits).toBe(2);
    expect(dash.recent[0]).toMatchObject({ id: VISIT, chats: 1, place: "Gering, Nebraska, United States" });
  });
});
