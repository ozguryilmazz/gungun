CREATE TABLE "trend_signals" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "trend_signals_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"provider_id" integer NOT NULL,
	"term" varchar(200) NOT NULL,
	"geo" char(2) NOT NULL,
	"approx_traffic" integer,
	"observed_at" timestamp with time zone NOT NULL,
	"published_at" timestamp with time zone,
	"related" jsonb DEFAULT '[]'::jsonb NOT NULL,
	CONSTRAINT "trend_signals_traffic_positive" CHECK ("trend_signals"."approx_traffic" is null or "trend_signals"."approx_traffic" >= 0)
);
--> statement-breakpoint
ALTER TABLE "fetch_runs" ADD COLUMN "details" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "trend_signals" ADD CONSTRAINT "trend_signals_provider_id_data_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."data_providers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "trend_signals_provider_term_time_uq" ON "trend_signals" USING btree ("provider_id","term","observed_at");--> statement-breakpoint
CREATE INDEX "trend_signals_observed_idx" ON "trend_signals" USING btree ("observed_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "trend_signals_term_idx" ON "trend_signals" USING btree ("term");