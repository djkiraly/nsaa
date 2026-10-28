ALTER TABLE "chat_messages" ALTER COLUMN "session_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD COLUMN "conversation_id" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD COLUMN "visitor_id" text;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD COLUMN "model" text;--> statement-breakpoint
CREATE INDEX "chat_messages_conversation" ON "chat_messages" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "chat_messages_created" ON "chat_messages" USING btree ("created_at");