CREATE TABLE "youtube_videos" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "youtube_videos_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"provider_id" integer NOT NULL,
	"video_id" varchar(32) NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"rank" smallint NOT NULL,
	"title" varchar(300) NOT NULL,
	"channel_title" varchar(200) NOT NULL,
	"published_at" timestamp with time zone,
	"view_count" bigint,
	"thumbnail_url" varchar(512),
	"category_id" varchar(8),
	CONSTRAINT "youtube_videos_rank_positive" CHECK ("youtube_videos"."rank" >= 1),
	CONSTRAINT "youtube_videos_views_positive" CHECK ("youtube_videos"."view_count" is null or "youtube_videos"."view_count" >= 0)
);
--> statement-breakpoint
ALTER TABLE "youtube_videos" ADD CONSTRAINT "youtube_videos_provider_id_data_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."data_providers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "youtube_videos_provider_video_time_uq" ON "youtube_videos" USING btree ("provider_id","video_id","observed_at");--> statement-breakpoint
CREATE INDEX "youtube_videos_observed_idx" ON "youtube_videos" USING btree ("observed_at" DESC NULLS LAST);