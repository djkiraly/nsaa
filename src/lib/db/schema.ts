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
    /** export_csv | regions | region_standings | leaders | bracket | district_finals */
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

/** Chat transcripts (optional; useful for improving the agent). */
export const chatMessages = pgTable("chat_messages", {
  id: serial("id").primaryKey(),
  sessionId: text("session_id").notNull(),
  role: text("role").notNull(),
  content: jsonb("content").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
