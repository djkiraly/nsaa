CREATE TABLE "chat_messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"role" text NOT NULL,
	"content" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sim_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"season" integer NOT NULL,
	"vb_class" text NOT NULL,
	"snapshot_id" integer NOT NULL,
	"n_sims" integer NOT NULL,
	"result" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"season" integer NOT NULL,
	"vb_class" text NOT NULL,
	"kind" text NOT NULL,
	"ref" text,
	"url" text NOT NULL,
	"body" text NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "snapshots_lookup" ON "snapshots" USING btree ("season","vb_class","kind","fetched_at");