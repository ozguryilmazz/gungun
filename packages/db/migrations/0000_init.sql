CREATE TYPE "public"."admin_role" AS ENUM('admin', 'editor');--> statement-breakpoint
CREATE TYPE "public"."fetch_status" AS ENUM('running', 'success', 'partial', 'failed');--> statement-breakpoint
CREATE TYPE "public"."provider_kind" AS ENUM('trend', 'news', 'social', 'manual');--> statement-breakpoint
CREATE TYPE "public"."summary_origin" AS ENUM('none', 'manual', 'ai');--> statement-breakpoint
CREATE TYPE "public"."timeline_event_type" AS ENUM('first_source', 'news_spread', 'search_spike', 'entered_top5', 'peak');--> statement-breakpoint
CREATE TYPE "public"."topic_status" AS ENUM('candidate', 'published', 'cooling', 'archived', 'hidden');--> statement-breakpoint
CREATE TABLE "admin_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" char(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_hash" char(64),
	CONSTRAINT "admin_sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "admin_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(254) NOT NULL,
	"password_hash" text NOT NULL,
	"role" "admin_role" DEFAULT 'editor' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"failed_login_count" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "audit_logs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"admin_user_id" uuid,
	"action" varchar(64) NOT NULL,
	"entity_type" varchar(32) NOT NULL,
	"entity_id" varchar(64),
	"changes" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"id" smallint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "categories_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 32767 START WITH 1 CACHE 1),
	"slug" varchar(32) NOT NULL,
	"name" varchar(64) NOT NULL,
	"sort_order" smallint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "categories_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "data_providers" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "data_providers_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"key" varchar(48) NOT NULL,
	"kind" "provider_kind" NOT NULL,
	"name" varchar(96) NOT NULL,
	"is_enabled" boolean DEFAULT false NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_success_at" timestamp with time zone,
	"last_error_at" timestamp with time zone,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "data_providers_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "fetch_runs" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "fetch_runs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"provider_id" integer NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"status" "fetch_status" DEFAULT 'running' NOT NULL,
	"items_fetched" integer DEFAULT 0 NOT NULL,
	"error_code" varchar(64),
	"error_message" varchar(500)
);
--> statement-breakpoint
CREATE TABLE "publishers" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "publishers_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"name" varchar(96) NOT NULL,
	"domain" varchar(253) NOT NULL,
	"homepage_url" varchar(2048) NOT NULL,
	"feed_url" varchar(2048),
	"is_active" boolean DEFAULT true NOT NULL,
	"is_mock" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "publishers_domain_unique" UNIQUE("domain"),
	CONSTRAINT "publishers_homepage_https" CHECK ("publishers"."homepage_url" like 'https://%'),
	CONSTRAINT "publishers_feed_https" CHECK ("publishers"."feed_url" is null or "publishers"."feed_url" like 'https://%')
);
--> statement-breakpoint
CREATE TABLE "source_items" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "source_items_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"provider_id" integer NOT NULL,
	"publisher_id" integer,
	"url" varchar(2048) NOT NULL,
	"url_hash" char(64) NOT NULL,
	"title" varchar(300) NOT NULL,
	"published_at" timestamp with time zone,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_mock" boolean DEFAULT false NOT NULL,
	CONSTRAINT "source_items_url_hash_unique" UNIQUE("url_hash"),
	CONSTRAINT "source_items_url_http" CHECK ("source_items"."url" like 'https://%' or "source_items"."url" like 'http://%')
);
--> statement-breakpoint
CREATE TABLE "timeline_events" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "timeline_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"topic_id" uuid NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"type" timeline_event_type NOT NULL,
	"source_item_id" bigint,
	"is_mock" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "topic_items" (
	"topic_id" uuid NOT NULL,
	"source_item_id" bigint NOT NULL,
	"relevance" real DEFAULT 1 NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "topic_items_topic_id_source_item_id_pk" PRIMARY KEY("topic_id","source_item_id"),
	CONSTRAINT "topic_items_relevance_range" CHECK ("topic_items"."relevance" >= 0 and "topic_items"."relevance" <= 1)
);
--> statement-breakpoint
CREATE TABLE "topic_slug_redirects" (
	"old_slug" varchar(160) PRIMARY KEY NOT NULL,
	"topic_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "topic_snapshots" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "topic_snapshots_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"topic_id" uuid NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	"score" smallint,
	"components" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"signals_available" smallint DEFAULT 0 NOT NULL,
	"signals_total" smallint DEFAULT 0 NOT NULL,
	"rank" smallint,
	"is_mock" boolean DEFAULT false NOT NULL,
	CONSTRAINT "topic_snapshots_score_range" CHECK ("topic_snapshots"."score" is null or "topic_snapshots"."score" between 0 and 100),
	CONSTRAINT "topic_snapshots_signals_range" CHECK ("topic_snapshots"."signals_available" >= 0 and "topic_snapshots"."signals_available" <= "topic_snapshots"."signals_total"),
	CONSTRAINT "topic_snapshots_rank_positive" CHECK ("topic_snapshots"."rank" is null or "topic_snapshots"."rank" > 0)
);
--> statement-breakpoint
CREATE TABLE "topics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" varchar(160) NOT NULL,
	"title" varchar(200) NOT NULL,
	"category_id" smallint NOT NULL,
	"summary" text,
	"reasons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" "topic_status" DEFAULT 'candidate' NOT NULL,
	"summary_origin" "summary_origin" DEFAULT 'none' NOT NULL,
	"is_mock" boolean DEFAULT false NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "topics_slug_unique" UNIQUE("slug"),
	CONSTRAINT "topics_slug_format" CHECK ("topics"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
	CONSTRAINT "topics_summary_length" CHECK ("topics"."summary" is null or char_length("topics"."summary") <= 1200),
	CONSTRAINT "topics_reasons_array" CHECK (jsonb_typeof("topics"."reasons") = 'array')
);
--> statement-breakpoint
ALTER TABLE "admin_sessions" ADD CONSTRAINT "admin_sessions_user_id_admin_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."admin_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_admin_user_id_admin_users_id_fk" FOREIGN KEY ("admin_user_id") REFERENCES "public"."admin_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fetch_runs" ADD CONSTRAINT "fetch_runs_provider_id_data_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."data_providers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_items" ADD CONSTRAINT "source_items_provider_id_data_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."data_providers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_items" ADD CONSTRAINT "source_items_publisher_id_publishers_id_fk" FOREIGN KEY ("publisher_id") REFERENCES "public"."publishers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timeline_events" ADD CONSTRAINT "timeline_events_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timeline_events" ADD CONSTRAINT "timeline_events_source_item_id_source_items_id_fk" FOREIGN KEY ("source_item_id") REFERENCES "public"."source_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topic_items" ADD CONSTRAINT "topic_items_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topic_items" ADD CONSTRAINT "topic_items_source_item_id_source_items_id_fk" FOREIGN KEY ("source_item_id") REFERENCES "public"."source_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topic_slug_redirects" ADD CONSTRAINT "topic_slug_redirects_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topic_snapshots" ADD CONSTRAINT "topic_snapshots_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topics" ADD CONSTRAINT "topics_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "admin_sessions_user_idx" ON "admin_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "admin_sessions_expires_idx" ON "admin_sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "admin_users_email_lower_uq" ON "admin_users" USING btree (lower("email"));--> statement-breakpoint
CREATE INDEX "audit_logs_created_idx" ON "audit_logs" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_logs_entity_idx" ON "audit_logs" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "fetch_runs_provider_started_idx" ON "fetch_runs" USING btree ("provider_id","started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "source_items_published_idx" ON "source_items" USING btree ("published_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "source_items_publisher_idx" ON "source_items" USING btree ("publisher_id");--> statement-breakpoint
CREATE INDEX "timeline_events_topic_time_idx" ON "timeline_events" USING btree ("topic_id","occurred_at");--> statement-breakpoint
CREATE INDEX "topic_items_source_item_idx" ON "topic_items" USING btree ("source_item_id");--> statement-breakpoint
CREATE INDEX "topic_slug_redirects_topic_idx" ON "topic_slug_redirects" USING btree ("topic_id");--> statement-breakpoint
CREATE UNIQUE INDEX "topic_snapshots_topic_time_uq" ON "topic_snapshots" USING btree ("topic_id","captured_at");--> statement-breakpoint
CREATE INDEX "topic_snapshots_captured_idx" ON "topic_snapshots" USING btree ("captured_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "topics_status_updated_idx" ON "topics" USING btree ("status","updated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "topics_category_idx" ON "topics" USING btree ("category_id");