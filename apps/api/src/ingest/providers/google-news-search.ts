import {
  dataProviders,
  sourceItems,
  trendNewsLinks,
  trendNewsSearches,
  type FetchRunDetail,
} from "@gundemci/db";
import { eq, inArray, sql } from "drizzle-orm";
import { checkRobots } from "../../lib/robots.ts";
import { titleMentionsTerm, trendKey } from "../../topics-pipeline/pipeline.ts";
import { isMediaTerm } from "../../topics-pipeline/text.ts";
import { describeError } from "../errors.ts";
import { parseFeed } from "../feed-parser.ts";
import { urlHash } from "../normalize.ts";
import { BOT_USER_AGENT, type IngestProvider, type ProviderContext } from "../types.ts";

const HOST = "news.google.com";
const BOT_TOKEN = "gundemciBot";
/** Trends verisi bundan eskiyse güncel trend listesi yok sayılır (pipeline ile aynı) */
const TRENDS_FRESH_HOURS = 2;
/** Bir terim için en fazla bu kadar haber saklanır */
const MAX_RESULTS_PER_TERM = 10;
/** Yalnızca son 48 saatin haberleri aramayı açıklayabilir */
const MAX_AGE_HOURS = 48;

const num = (v: unknown, fallback: number, min: number, max: number) =>
  typeof v === "number" && Number.isFinite(v)
    ? Math.min(Math.max(Math.trunc(v), min), max)
    : fallback;

/** Google Haberler arama adresi: son 1 günün Türkçe haberleri */
export function searchUrl(term: string): string {
  const q = term.includes(" ") ? `"${term}"` : term;
  const params = new URLSearchParams({ q: `${q} when:1d`, hl: "tr", gl: "TR", ceid: "TR:tr" });
  return `https://${HOST}/rss/search?${params}`;
}

/** Google Haberler başlıkları "Başlık - Kaynak" biçimindedir; kaynak eki atılır */
export function stripSourceSuffix(title: string, source: string | null): string {
  if (!source) return title;
  const suffix = ` - ${source}`;
  return title.endsWith(suffix) ? title.slice(0, -suffix.length).trim() : title;
}

/**
 * Google Haberler arama RSS'i ile güncel trend aramaları AÇIKLAYAN haberleri bulur.
 * - Yalnızca başlık, kaynak adı ve bağlantı alınır; haber metni alınmaz.
 * - robots.txt her çalışmada (6 saat önbellekli) denetlenir; izin yoksa ya da okunamazsa istek atılmaz.
 * - Aynı terim en fazla saatte bir aranır; istekler arasında bekleme vardır.
 */
export const googleNewsSearchProvider: IngestProvider = {
  key: "google_news_search",

  async run(ctx: ProviderContext) {
    const { db, provider, now, fetcher, log } = ctx;
    const userAgent =
      typeof provider.config.userAgent === "string" ? provider.config.userAgent : BOT_USER_AGENT;
    const perTermMinutes = num(provider.config.perTermMinutes, 60, 15, 24 * 60);
    const maxTerms = num(provider.config.maxTermsPerRun, 25, 1, 50);
    const delayMs = num(provider.config.requestDelayMs, 1000, 0, 10_000);

    const robots = await checkRobots(fetcher, searchUrl("test"), {
      userAgent,
      botToken: BOT_TOKEN,
    });
    if (robots !== "allowed") {
      const message =
        robots === "disallowed"
          ? "robots.txt bu sayfaya izin vermiyor; istek atılmadı"
          : "robots.txt okunamadı; istek atılmadı";
      return {
        status: "failed" as const,
        itemsFetched: 0,
        details: [{ name: "Google Haberler", ok: false, items: 0, error: message }],
        errorCode: robots === "disallowed" ? "robots_disallowed" : "robots_unknown",
        errorMessage: message,
      };
    }

    // Güncel trend terimleri (Google Trends'in son listesi), arama hacmine göre
    const [trends] = await db
      .select({ id: dataProviders.id })
      .from(dataProviders)
      .where(eq(dataProviders.key, "google_trends"));
    if (!trends) return { status: "success" as const, itemsFetched: 0, details: [] };
    const freshSince = new Date(now.getTime() - TRENDS_FRESH_HOURS * 3_600_000);
    const termRows = await db.execute<{ term: string; traffic: number | null }>(sql`
      select term, max(approx_traffic) as traffic from trend_signals
      where provider_id = ${trends.id}
        and observed_at = (
          select max(observed_at) from trend_signals
          where provider_id = ${trends.id}
            and observed_at >= ${freshSince.toISOString()}
            and observed_at <= ${now.toISOString()}
        )
      group by term
    `);
    const candidates = new Map<string, { term: string; traffic: number }>();
    for (const r of termRows) {
      const key = trendKey(r.term);
      if (!key || isMediaTerm(r.term) || candidates.has(key)) continue;
      candidates.set(key, { term: r.term.trim(), traffic: Number(r.traffic ?? 0) });
    }
    if (candidates.size === 0) return { status: "success" as const, itemsFetched: 0, details: [] };

    // Yakın zamanda aranmış terimler atlanır; hiç aranmamış olanlar önce, sonra en eski aranan
    const searched = new Map(
      (
        await db
          .select({ key: trendNewsSearches.trendKey, at: trendNewsSearches.searchedAt })
          .from(trendNewsSearches)
          .where(inArray(trendNewsSearches.trendKey, [...candidates.keys()]))
      ).map((r) => [r.key, r.at]),
    );
    const due = [...candidates.entries()]
      .filter(([key]) => {
        const at = searched.get(key);
        return !at || now.getTime() - at.getTime() >= perTermMinutes * 60_000;
      })
      .sort(
        ([ka, a], [kb, b]) =>
          (searched.get(ka)?.getTime() ?? 0) - (searched.get(kb)?.getTime() ?? 0) ||
          b.traffic - a.traffic,
      )
      .slice(0, maxTerms);

    const details: FetchRunDetail[] = [];
    let inserted = 0;
    let failures = 0;
    const oldest = new Date(now.getTime() - MAX_AGE_HOURS * 3_600_000);

    for (const [i, [key, { term }]] of due.entries()) {
      if (i > 0 && delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
      try {
        const res = await fetcher(searchUrl(term), {
          isHostAllowed: (h) => h === HOST,
          userAgent,
        });
        const items = parseFeed(res.body, res.contentType, now)
          .map((it) => ({ ...it, title: stripSourceSuffix(it.title, it.source) }))
          // Yalnızca başlığında terim geçen ve güncel olan haberler aramayı açıklayabilir
          .filter((it) => titleMentionsTerm(it.title, term))
          .filter((it) => !it.publishedAt || it.publishedAt >= oldest)
          .slice(0, MAX_RESULTS_PER_TERM);

        let added = 0;
        if (items.length) {
          const rows = await db
            .insert(sourceItems)
            .values(
              items.map((it) => ({
                providerId: provider.id,
                publisherId: null,
                sourceName: it.source,
                url: it.url,
                urlHash: urlHash(it.url),
                title: it.title.slice(0, 300),
                publishedAt: it.publishedAt,
                fetchedAt: now,
              })),
            )
            .onConflictDoNothing({ target: sourceItems.urlHash })
            .returning({ id: sourceItems.id });
          added = rows.length;
          const ids = await db
            .select({ id: sourceItems.id })
            .from(sourceItems)
            .where(
              inArray(
                sourceItems.urlHash,
                items.map((it) => urlHash(it.url)),
              ),
            );
          if (ids.length) {
            await db
              .insert(trendNewsLinks)
              .values(ids.map((r) => ({ trendKey: key, sourceItemId: r.id, foundAt: now })))
              .onConflictDoNothing();
          }
        }
        await db
          .insert(trendNewsSearches)
          .values({ trendKey: key, searchedAt: now, resultCount: items.length })
          .onConflictDoUpdate({
            target: trendNewsSearches.trendKey,
            set: { searchedAt: now, resultCount: items.length },
          });
        inserted += added;
        details.push({ name: term.slice(0, 60), ok: true, items: added, parsed: items.length });
      } catch (error) {
        failures++;
        const { code, message } = describeError(error);
        log.warn({ code, message }, "Google Haberler araması başarısız");
        details.push({
          name: term.slice(0, 60),
          ok: false,
          items: 0,
          error: `${code}: ${message}`,
        });
        // Google istekleri sınırlıyorsa (429) bu çalışmada daha fazla istek atılmaz
        if (message === "HTTP 429") break;
      }
    }

    const status = failures === 0 ? "success" : failures < details.length ? "partial" : "failed";
    return {
      status: status as "success" | "partial" | "failed",
      itemsFetched: inserted,
      details,
      ...(status === "failed"
        ? { errorCode: "all_failed", errorMessage: "Aramaların hiçbiri yapılamadı" }
        : {}),
    };
  },
};
