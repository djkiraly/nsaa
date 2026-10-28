import { pgTable, serial, text, timestamp, integer, jsonb, index } from "drizzle-orm/pg-core";

/**
 * Raw NSAA snapshots. One row per (class, kind) per scrape. The engine is
 * rebuilt from the latest snapshot set, so the app has a full audit trail of
 * what NSAA published and when.
 */
export const snapshots = pgTable(
  "snapshots",
  {
    id: serial("id").primaryKey(),
    season: integer("season").notNull(),
    /** "A".."D2" or "ALL" for class-independent pages */
    vbClass: text("vb_class").notNull(),
    /** export_csv | regions | region_standings | subdistricts | leaders | bracket | district_finals */
    kind: text("kind").notNull(),
    /** e.g. distid for bracket pages */
    ref: text("ref"),
    url: text("url").notNull(),
    body: text("body").notNull(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("snapshots_lookup").on(t.season, t.vbClass, t.kind, t.fetchedAt)],
);

/** Cached simulation results keyed by the snapshot set they were built from. */
export const simRuns = pgTable("sim_runs", {
  id: serial("id").primaryKey(),
  season: integer("season").notNull(),
  vbClass: text("vb_class").notNull(),
  snapshotId: integer("snapshot_id").notNull(),
  nSims: integer("n_sims").notNull(),
  result: jsonb("result").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Site analytics: one row per visit (session). A session ends after 30 minutes without activity; the browser sends
 * a heartbeat every 30 s while the page is visible, so last_seen_at − started_at is the visit's length. No IP
 * addresses are stored — only the city/region/country they resolve to.
 */
export const analyticsSessions = pgTable(
  "analytics_sessions",
  {
    /** random id from the browser */
    id: text("id").primaryKey(),
    /** random id kept in the browser's localStorage — same person across visits */
    visitorId: text("visitor_id").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    pageviews: integer("pageviews").notNull().default(0),
    entryPath: text("entry_path"),
    /** referring site's host, when it isn't this site */
    referrer: text("referrer"),
    country: text("country"),
    region: text("region"),
    city: text("city"),
    /** mobile | tablet | desktop */
    device: text("device"),
    browser: text("browser"),
    os: text("os"),
  },
  (t) => [index("analytics_sessions_started").on(t.startedAt), index("analytics_sessions_visitor").on(t.visitorId)],
);

/** Page views and other events (e.g. a chat question asked) within a session. */
export const analyticsEvents = pgTable(
  "analytics_events",
  {
    id: serial("id").primaryKey(),
    sessionId: text("session_id").notNull(),
    visitorId: text("visitor_id").notNull(),
    /** pageview | chat */
    type: text("type").notNull(),
    path: text("path").notNull(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("analytics_events_at").on(t.at, t.type)],
);

/**
 * Chat transcripts, shown on the private /analytics pages. One row per question (role "user", content
 * `{ text }`) and per answer (role "assistant", content `{ text, tools, usage, ms, error? }` — see
 * src/lib/chat-log.ts). A conversation is one chat page load; the visit and visitor ids tie it to the analytics
 * session when the browser isn't opted out of tracking.
 */
export const chatMessages = pgTable(
  "chat_messages",
  {
    id: serial("id").primaryKey(),
    /** random id from the browser, one per chat page load */
    conversationId: text("conversation_id").notNull().default(""),
    /** analytics visit id (analytics_sessions.id), when tracking is on */
    sessionId: text("session_id"),
    visitorId: text("visitor_id"),
    role: text("role").notNull(),
    content: jsonb("content").notNull(),
    model: text("model"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("chat_messages_conversation").on(t.conversationId, t.createdAt), index("chat_messages_created").on(t.createdAt)],
);
