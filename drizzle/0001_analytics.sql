CREATE TABLE "analytics_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"visitor_id" text NOT NULL,
	"type" text NOT NULL,
	"path" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "analytics_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"visitor_id" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"pageviews" integer DEFAULT 0 NOT NULL,
	"entry_path" text,
	"referrer" text,
	"country" text,
	"region" text,
	"city" text,
	"device" text,
	"browser" text,
	"os" text
);
--> statement-breakpoint
CREATE INDEX "analytics_events_at" ON "analytics_events" USING btree ("at","type");--> statement-breakpoint
CREATE INDEX "analytics_sessions_started" ON "analytics_sessions" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "analytics_sessions_visitor" ON "analytics_sessions" USING btree ("visitor_id");