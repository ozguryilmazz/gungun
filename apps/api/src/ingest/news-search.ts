// Trend aramalarını AÇIKLAYAN haberleri bir haber arama kaynağında arayan ortak mantık.
// Kaynağa özgü olanlar (adres, ayrıştırma, bekleme süresi) sağlayıcıdan gelir.
//  - Yalnızca başlık, kaynak adı ve bağlantı alınır; haber metni alınmaz.
//  - robots.txt her çalışmada (6 saat önbellekli) denetlenir; izin yoksa ya da okunamazsa istek atılmaz.
//  - Elenen aramalar (site adı, canlı yayın…) aranmaz; aynı terim en fazla `perTermMinutes`'ta bir aranır.
//  - Yalnızca başlığında terim geçen, son 48 saatin haberleri saklanır.
// Not: "son arama zamanı" tablosu (trend_news_searches) tüm arama kaynaklarında ortaktır;
// aynı anda tek bir arama kaynağının açık olması beklenir.
import {
  dataProviders,
  sourceItems,
  trendNewsLinks,
  trendNewsSearches,
  type FetchRunDetail,
} from "@gundemci/db";
import { eq, inArray, sql } from "drizzle-orm";
import { checkRobots } from "../lib/robots.ts";
import { SafeFetchError } from "../lib/safe-http.ts";
import { titleMentionsTerm, trendKey } from "../topics-pipeline/pipeline.ts";
import { classifyTerm } from "../topics-pipeline/term-filter.ts";
import { describeError } from "./errors.ts";
import { urlHash } from "./normalize.ts";
import { BOT_USER_AGENT, type ProviderContext, type ProviderOutcome } from "./types.ts";

const BOT_TOKEN = "gundemciBot";
/** Trends verisi bundan eskiyse güncel trend listesi yok sayılır (pipeline ile aynı) */
const TRENDS_FRESH_HOURS = 2;
/** Bir terim için en fazla bu kadar haber saklanır */
const MAX_RESULTS_PER_TERM = 10;
/** Yalnızca son 48 saatin haberleri aramayı açıklayabilir */
const MAX_AGE_HOURS = 48;

export interface SearchResultItem {
  title: string;
  url: string;
  source: string | null;
  publishedAt: Date | null;
}

export interface NewsSearchOptions {
  /** Durum ekranında görünen ad ("GDELT") */
  label: string;
  host: string;
  searchUrl: (term: string) => string;
  parse: (body: Buffer, contentType: string, now: Date) => SearchResultItem[];
  accept?: string;
  defaults: { delayMs: number; maxTerms: number; perTermMinutes: number };
  /** Bu kaynakta aranamayacak terimler (ör. çok kısa) */
  skipTerm?: (term: string) => boolean;
}

const isRateLimited = (error: unknown) => error instanceof SafeFetchError && error.status === 429;

export const num = (v: unknown, fallback: number, min: number, max: number) =>
  typeof v === "number" && Number.isFinite(v)
    ? Math.min(Math.max(Math.trunc(v), min), max)
    : fallback;

export async function runTrendNewsSearch(
  ctx: ProviderContext,
  opts: NewsSearchOptions,
): Promise<ProviderOutcome> {
  const { db, provider, now, fetcher, log } = ctx;
  const userAgent =
    typeof provider.config.userAgent === "string" ? provider.config.userAgent : BOT_USER_AGENT;
  const perTermMinutes = num(
    provider.config.perTermMinutes,
    opts.defaults.perTermMinutes,
    15,
    24 * 60,
  );
  const maxTerms = num(provider.config.maxTermsPerRun, opts.defaults.maxTerms, 1, 50);
  const delayMs = num(provider.config.requestDelayMs, opts.defaults.delayMs, 0, 30_000);

  const robots = await checkRobots(fetcher, opts.searchUrl("test"), {
    userAgent,
    botToken: BOT_TOKEN,
  });
  if (robots !== "allowed") {
    const message =
      robots === "disallowed"
        ? "robots.txt bu sayfaya izin vermiyor; istek atılmadı"
        : "robots.txt okunamadı; istek atılmadı";
    return {
      status: "failed",
      itemsFetched: 0,
      details: [{ name: opts.label, ok: false, items: 0, error: message }],
      errorCode: robots === "disallowed" ? "robots_disallowed" : "robots_unknown",
      errorMessage: message,
    };
  }

  // Güncel trend terimleri (Google Trends'in son listesi), arama hacmine göre
  const [trends] = await db
    .select({ id: dataProviders.id })
    .from(dataProviders)
    .where(eq(dataProviders.key, "google_trends"));
  if (!trends) return { status: "success", itemsFetched: 0, details: [] };
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
    // Elenen aramalar (site adı, canlı yayın, hava durumu…) için arama yapılmaz
    if (!key || classifyTerm(r.term).verdict === "exclude" || candidates.has(key)) continue;
    if (opts.skipTerm?.(r.term)) continue;
    candidates.set(key, { term: r.term.trim(), traffic: Number(r.traffic ?? 0) });
  }
  if (candidates.size === 0) return { status: "success", itemsFetched: 0, details: [] };

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

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const search = async (term: string) => {
    const res = await fetcher(opts.searchUrl(term), {
      isHostAllowed: (h) => h === opts.host,
      userAgent,
      ...(opts.accept ? { accept: opts.accept } : {}),
    });
    return opts.parse(res.body, res.contentType, now);
  };
  // Sınır aşıldıysa (429) daha uzun beklenip aynı arama bir kez daha denenir
  const searchWithRetry = async (term: string) => {
    try {
      return await search(term);
    } catch (error) {
      if (!isRateLimited(error)) throw error;
      if (delayMs > 0) await sleep(Math.max(delayMs * 2, 10_000));
      return search(term);
    }
  };

  for (const [key, { term }] of due) {
    // İlk aramadan önce de beklenir: robots.txt isteği de kaynağın sınırına sayılabilir
    if (delayMs > 0) await sleep(delayMs);
    try {
      const items = (await searchWithRetry(term))
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
      log.warn({ code, message, source: opts.label }, "haber araması başarısız");
      details.push({
        name: term.slice(0, 60),
        ok: false,
        items: 0,
        error: `${code}: ${message}`,
      });
      // Kaynak istekleri hâlâ sınırlıyorsa (429) bu çalışmada daha fazla istek atılmaz
      if (isRateLimited(error)) break;
    }
  }

  const status = failures === 0 ? "success" : failures < details.length ? "partial" : "failed";
  return {
    status,
    itemsFetched: inserted,
    details,
    ...(status === "failed"
      ? { errorCode: "all_failed", errorMessage: "Aramaların hiçbiri yapılamadı" }
      : {}),
  };
}
