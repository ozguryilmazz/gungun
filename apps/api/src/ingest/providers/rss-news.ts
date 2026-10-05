import { and, asc, eq, isNotNull } from "drizzle-orm";
import { publishers, sourceItems, type FetchRunDetail } from "@gundemci/db";
import { describeError } from "../errors.ts";
import { parseFeed } from "../feed-parser.ts";
import { hostBelongsTo, urlHash } from "../normalize.ts";
import { BOT_USER_AGENT, type IngestProvider, type ProviderContext } from "../types.ts";

const CONCURRENCY = 3;

async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]!);
    }
  });
  await Promise.all(workers);
  return results;
}

/** Haber sitelerinin RSS akışları. Yalnızca başlık, bağlantı ve yayın zamanı saklanır. */
export const rssNewsProvider: IngestProvider = {
  key: "rss_news",

  async run(ctx: ProviderContext) {
    const { db, provider, now, fetcher, log } = ctx;
    const userAgent =
      typeof provider.config.userAgent === "string" ? provider.config.userAgent : BOT_USER_AGENT;

    const rows = await db
      .select({
        id: publishers.id,
        name: publishers.name,
        domain: publishers.domain,
        feedUrl: publishers.feedUrl,
      })
      .from(publishers)
      .where(
        and(
          eq(publishers.isActive, true),
          eq(publishers.isMock, false),
          isNotNull(publishers.feedUrl),
        ),
      )
      .orderBy(asc(publishers.id));
    const feeds = rows.map((r) => ({ ...r, feedUrl: r.feedUrl! }));
    if (feeds.length === 0) {
      return {
        status: "failed" as const,
        itemsFetched: 0,
        details: [],
        errorCode: "no_feeds",
        errorMessage: "Aktif haber kaynağı yok",
      };
    }

    const details = await mapLimit(feeds, CONCURRENCY, async (feed): Promise<FetchRunDetail> => {
      const feedHost = new URL(feed.feedUrl).hostname.toLowerCase();
      try {
        const res = await fetcher(feed.feedUrl, {
          // Yalnızca bu yayıncının alan adı ve feed'in kendi host'u (yönlendirmeler dahil)
          isHostAllowed: (host) => host === feedHost || hostBelongsTo(host, feed.domain),
          userAgent,
        });
        const parsed = parseFeed(res.body, res.contentType, now, res.finalUrl);
        // Başka sitelere işaret eden bağlantılar alınmaz (feed enjeksiyonuna karşı)
        const items = parsed.filter((i) => hostBelongsTo(new URL(i.url).hostname, feed.domain));
        let inserted = 0;
        if (items.length > 0) {
          const rows = await db
            .insert(sourceItems)
            .values(
              items.map((i) => ({
                providerId: provider.id,
                publisherId: feed.id,
                url: i.url,
                urlHash: urlHash(i.url),
                title: i.title,
                publishedAt: i.publishedAt,
                fetchedAt: now,
              })),
            )
            .onConflictDoNothing({ target: sourceItems.urlHash })
            .returning({ id: sourceItems.id });
          inserted = rows.length;
        }
        const offDomain = parsed.length - items.length;
        const offDomainHosts = [
          ...new Set(parsed.filter((i) => !items.includes(i)).map((i) => new URL(i.url).hostname)),
        ].slice(0, 3);
        if (offDomain > 0)
          log.warn(
            { feed: feed.name, offDomain, offDomainHosts },
            "alan adı dışı bağlantılar atlandı",
          );
        return {
          name: feed.name,
          ok: true,
          items: inserted,
          parsed: parsed.length,
          ...(offDomain > 0 ? { offDomain, offDomainHosts } : {}),
        };
      } catch (error) {
        const { code, message } = describeError(error);
        log.warn({ feed: feed.name, code, message }, "feed alınamadı");
        return { name: feed.name, ok: false, items: 0, error: `${code}: ${message}` };
      }
    });

    const okCount = details.filter((d) => d.ok).length;
    const itemsFetched = details.reduce((sum, d) => sum + d.items, 0);
    if (okCount === details.length) return { status: "success" as const, itemsFetched, details };
    const failedNames = details
      .filter((d) => !d.ok)
      .map((d) => d.name)
      .join(", ");
    return {
      status: okCount === 0 ? ("failed" as const) : ("partial" as const),
      itemsFetched,
      details,
      errorCode: okCount === 0 ? "all_feeds_failed" : "some_feeds_failed",
      errorMessage:
        `${details.length - okCount}/${details.length} kaynak alınamadı: ${failedNames}`.slice(
          0,
          500,
        ),
    };
  },
};
