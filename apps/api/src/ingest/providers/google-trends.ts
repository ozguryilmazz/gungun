import { trendSignals } from "@gundemci/db";
import { describeError } from "../errors.ts";
import { parseTrends } from "../feed-parser.ts";
import { BOT_USER_AGENT, type IngestProvider, type ProviderContext } from "../types.ts";

const DEFAULT_FEED = "https://trends.google.com/trending/rss?geo=TR";

/**
 * Google Trends'in herkese açık "trending" RSS akışı. Her çekmede listedeki terimler
 * gözlem olarak kaydedilir. Resmi olmayan/kazıma yöntemleri KULLANILMAZ.
 */
export const googleTrendsProvider: IngestProvider = {
  key: "google_trends",

  async run(ctx: ProviderContext) {
    const { db, provider, now, fetcher, log } = ctx;
    const feedUrl =
      typeof provider.config.feedUrl === "string" ? provider.config.feedUrl : DEFAULT_FEED;
    const geo =
      typeof provider.config.geo === "string" && /^[A-Z]{2}$/.test(provider.config.geo)
        ? provider.config.geo
        : "TR";
    const userAgent =
      typeof provider.config.userAgent === "string" ? provider.config.userAgent : BOT_USER_AGENT;

    try {
      const allowedHost = new URL(feedUrl).hostname.toLowerCase();
      const res = await fetcher(feedUrl, {
        isHostAllowed: (host) => host === allowedHost,
        userAgent,
      });
      const trends = parseTrends(res.body, res.contentType, now);
      let inserted = 0;
      if (trends.length > 0) {
        const rows = await db
          .insert(trendSignals)
          .values(
            trends.map((t) => ({
              providerId: provider.id,
              term: t.term,
              geo,
              approxTraffic: t.approxTraffic,
              observedAt: now,
              publishedAt: t.publishedAt,
              related: t.related,
            })),
          )
          .onConflictDoNothing()
          .returning({ id: trendSignals.id });
        inserted = rows.length;
      }
      return {
        status: "success" as const,
        itemsFetched: inserted,
        details: [{ name: "Google Trends", ok: true, items: inserted }],
      };
    } catch (error) {
      const { code, message } = describeError(error);
      log.warn({ code, message }, "Google Trends alınamadı");
      return {
        status: "failed" as const,
        itemsFetched: 0,
        details: [{ name: "Google Trends", ok: false, items: 0, error: `${code}: ${message}` }],
        errorCode: code,
        errorMessage: message,
      };
    }
  },
};
