CREATE TABLE "news_stories" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "news_stories_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"title" varchar(300) NOT NULL,
	"publisher_count" smallint NOT NULL,
	"first_item_at" timestamp with time zone NOT NULL,
	"listed_at" timestamp with time zone NOT NULL,
	"last_growth_at" timestamp with time zone,
	"last_growth_by" smallint,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "news_stories_publisher_count_positive" CHECK ("news_stories"."publisher_count" > 0)
);
--> statement-breakpoint
CREATE TABLE "news_story_items" (
	"source_item_id" bigint PRIMARY KEY NOT NULL,
	"story_id" bigint NOT NULL,
	"added_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "news_story_items" ADD CONSTRAINT "news_story_items_source_item_id_source_items_id_fk" FOREIGN KEY ("source_item_id") REFERENCES "public"."source_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "news_story_items" ADD CONSTRAINT "news_story_items_story_id_news_stories_id_fk" FOREIGN KEY ("story_id") REFERENCES "public"."news_stories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "news_stories_first_item_idx" ON "news_stories" USING btree ("first_item_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "news_story_items_story_idx" ON "news_story_items" USING btree ("story_id");