CREATE TABLE "trend_news_links" (
	"trend_key" varchar(200) NOT NULL,
	"source_item_id" bigint NOT NULL,
	"found_at" timestamp with time zone NOT NULL,
	CONSTRAINT "trend_news_links_trend_key_source_item_id_pk" PRIMARY KEY("trend_key","source_item_id")
);
--> statement-breakpoint
CREATE TABLE "trend_news_searches" (
	"trend_key" varchar(200) PRIMARY KEY NOT NULL,
	"searched_at" timestamp with time zone NOT NULL,
	"result_count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "trend_news_links" ADD CONSTRAINT "trend_news_links_source_item_id_source_items_id_fk" FOREIGN KEY ("source_item_id") REFERENCES "public"."source_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "trend_news_links_found_idx" ON "trend_news_links" USING btree ("found_at" DESC NULLS LAST);