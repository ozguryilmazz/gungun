CREATE TYPE "public"."topic_kind" AS ENUM('trend', 'news');--> statement-breakpoint
ALTER TYPE "public"."timeline_event_type" ADD VALUE 'trend_listed';--> statement-breakpoint
ALTER TYPE "public"."timeline_event_type" ADD VALUE 'trend_left';--> statement-breakpoint
ALTER TABLE "source_items" ADD COLUMN "source_name" varchar(96);--> statement-breakpoint
ALTER TABLE "topics" ADD COLUMN "kind" "topic_kind" DEFAULT 'news' NOT NULL;--> statement-breakpoint
ALTER TABLE "topics" ADD COLUMN "trend_key" varchar(200);--> statement-breakpoint
CREATE INDEX "topics_kind_status_idx" ON "topics" USING btree ("kind","status");--> statement-breakpoint
CREATE UNIQUE INDEX "topics_trend_key_uq" ON "topics" USING btree ("trend_key");