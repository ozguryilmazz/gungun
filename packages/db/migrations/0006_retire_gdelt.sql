-- GDELT kaldırıldı: bulduğu haberler (topic_items CASCADE ile) ve sağlayıcı kaydı (fetch_runs CASCADE ile) silinir.
-- Bu veriler türetilmiş önbellektir; kaynağı haber siteleridir.
DELETE FROM "source_items" WHERE "provider_id" IN (SELECT "id" FROM "data_providers" WHERE "key" = 'gdelt_news');--> statement-breakpoint
DELETE FROM "data_providers" WHERE "key" = 'gdelt_news';--> statement-breakpoint
DROP TABLE "trend_news_links" CASCADE;--> statement-breakpoint
DROP TABLE "trend_news_searches" CASCADE;
