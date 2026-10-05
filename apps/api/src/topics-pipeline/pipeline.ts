// Gündem üretimi — ARAMA ÖNCELİKLİ (docs/02-arama-oncelikli-plan.md).
//
//  1. Trend konuları: Google Trends'teki her arama terimi bir konudur. Haberler konuyu AÇIKLAR:
//     eşleşen haber kümesi + Google'ın "ilgili haberler" listesi konuya bağlanır.
//  2. Haber konuları: Hiçbir aramayla eşleşmeyen ama çok kaynakta geçen olaylar
//     ("Haberlerde öne çıkanlar"); ana listeye karışmaz.
//
// Yapay zekâ KULLANILMAZ; özet üretilmez, "neden gündemde" maddeleri yalnızca ölçülen veridir.
// Örnek (mock) konulara dokunulmaz.
import { randomBytes } from "node:crypto";
import { and, eq, inArray, notInArray, sql } from "drizzle-orm";
import {
  categories,
  dataProviders,
  publishers,
  sourceItems,
  timelineEvents,
  topicItems,
  topicSnapshots,
  topics,
  type Database,
} from "@gundemci/db";
import {
  COMPONENT_KEYS,
  computeScore,
  type ComponentInput,
  type ScoreComponents,
} from "@gundemci/shared";
import type postgres from "postgres";
import { urlHash } from "../ingest/normalize.ts";
import type { Logger } from "../ingest/types.ts";
import { inferCategory } from "./category.ts";
import {
  clusterItems,
  distinctPublishers,
  representative,
  type Cluster,
  type ClusterInput,
} from "./cluster.ts";
import { calmTitle, isMediaTerm, isTermWithCase, slugify, tokenize, words } from "./text.ts";

/** Konu oluşturma ve yaşam döngüsü eşikleri */
export const RULES = {
  windowHours: 24,
  /** Haber konusu kaydı için en az farklı yayıncı */
  minPublishersToCreate: 2,
  /** Haber konusunun "Haberlerde öne çıkanlar"da görünmesi için en az farklı yayıncı */
  minPublishersToPublishNews: 4,
  /** Haber konusu: bu süredir yeni haber yoksa "soğuyan" / arşiv */
  newsCoolingAfterHours: 6,
  newsArchiveAfterHours: 24,
  /** Trends verisi bu kadar eskiyse güncel trend listesi yok sayılır */
  trendsFreshHours: 2,
  /** Trend konusu listeden çıktıktan bu kadar sonra arşive düşer (arada "soğuyan") */
  trendArchiveAfterHours: 3,
  /** Bir trend teriminin haber kümesiyle eşleşmesi için terimi içeren başlık oranı */
  trendMatchRatio: 0.3,
  /** "3 saat önceki" trafik ölçümü için en az geçmiş */
  trendCompareMinHours: 2.5,
} as const;

export interface PipelineResult {
  skipped?: "locked";
  itemsInWindow: number;
  clusters: number;
  trends: number;
  created: number;
  snapshots: number;
  published: number;
  cooling: number;
  archived: number;
}

export interface PipelineDeps {
  db: Database;
  client: postgres.Sql;
  log: Logger;
  now?: () => Date;
}

type Status = "candidate" | "published" | "cooling" | "archived" | "hidden";

/** Eşleştirme için trend terimi */
export interface TrendObservation {
  term: string;
  tokens: string[];
  approxTraffic: number | null;
}

/** Son 24 saatin gözlemlerinden derlenmiş bir trend terimi */
export interface TrendInfo extends TrendObservation {
  key: string;
  /** Şu an güncel trend listesinde mi? */
  current: boolean;
  firstObservedAt: Date;
  lastObservedAt: Date;
  /** ~3 saat önceki trafik (yoksa null) */
  previousTraffic: number | null;
  related: { title: string; url: string; source: string }[];
}

const hoursAgo = (now: Date, h: number) => new Date(now.getTime() - h * 3_600_000);

export function trendKey(term: string): string {
  return term.toLocaleLowerCase("tr-TR").trim().replace(/\s+/g, " ").slice(0, 200);
}

/** Google trend terimleri çoğunlukla küçük harftir: "ali koç" → "Ali Koç" */
export function displayTerm(term: string): string {
  const t = term.trim().replace(/\s+/g, " ");
  if (t !== t.toLocaleLowerCase("tr-TR")) return t.slice(0, 200);
  return t
    .split(" ")
    .map((w) => w.charAt(0).toLocaleUpperCase("tr-TR") + w.slice(1))
    .join(" ")
    .slice(0, 200);
}

/** Arama ilgisi: log ölçek, 1 milyon arama ≈ 1.0; trafik bilinmiyorsa 0.5 */
function trafficToNormalized(traffic: number | null): number {
  if (traffic === null || traffic <= 0) return 0.5;
  return Math.min(Math.log10(traffic) / 6, 1);
}

const round4 = (n: number) => Number(n.toFixed(4));

/**
 * Bir trend teriminin bir haber kümesiyle eşleşme oranı. Yanlış eşleşmeye karşı:
 *  - medya adları (Sözcü, Sabah, NTV…) hiç eşleşmez;
 *  - tek kelimelik terim, kelimenin kendisi veya hal ekli hâliyle eşleşir; iyelik ekli hâli eşleşmez:
 *    "derbi" → "derbide" eşleşir, "sözcü" → "AK Parti Sözcüsü" eşleşmez;
 *  - çok kelimeli terimde tüm kelime kökleri başlıkta geçmelidir.
 */
export function trendMatchRatio(cluster: Cluster, trend: TrendObservation): number {
  if (trend.tokens.length === 0 || isMediaTerm(trend.term)) return 0;
  const termWords = words(trend.term);
  const single = termWords.length === 1 ? termWords[0]! : null;
  const hits = cluster.items.filter((i) => {
    if (single) return words(i.title).some((w) => isTermWithCase(w, single));
    const tokens = new Set(tokenize(i.title));
    return trend.tokens.every((t) => tokens.has(t));
  }).length;
  return hits / cluster.items.length;
}

/** Kümeyle en iyi eşleşen trend (eşik altında null) */
export function matchTrend(cluster: Cluster, trends: TrendObservation[]): TrendObservation | null {
  let best: TrendObservation | null = null;
  let bestRatio = 0;
  for (const trend of trends) {
    const ratio = trendMatchRatio(cluster, trend);
    if (ratio >= RULES.trendMatchRatio && ratio > bestRatio) {
      best = trend;
      bestRatio = ratio;
    }
  }
  return best;
}

/** Trend terimiyle en iyi eşleşen haber kümesi (eşitlikte büyük küme) */
export function bestClusterForTrend(clusters: Cluster[], trend: TrendObservation): Cluster | null {
  let best: Cluster | null = null;
  let bestRatio = 0;
  for (const c of clusters) {
    const ratio = trendMatchRatio(c, trend);
    if (ratio < RULES.trendMatchRatio) continue;
    if (ratio > bestRatio || (ratio === bestRatio && best && c.items.length > best.items.length)) {
      best = c;
      bestRatio = ratio;
    }
  }
  return best;
}

/** Trend konusu skoru: arama %50 · sosyal %25 · haber %15 · hız %10 (bkz. shared/scoring) */
export function scoreTrend(
  trend: TrendInfo,
  newsItems: ClusterInput[],
  now: Date,
  ctx: { publisherTotal: number; trendsAvailable: boolean },
): { normalized: ComponentInput; raw: Record<string, number | null> } {
  const recentNews = newsItems.filter((i) => i.at >= hoursAgo(now, 6));
  const newsSources =
    distinctPublishers(recentNews) +
    new Set(trend.related.map((r) => r.source.toLocaleLowerCase("tr-TR"))).size;
  const newsVisibility =
    newsSources === 0
      ? 0
      : Math.min(Math.log(1 + newsSources) / Math.log(1 + Math.max(ctx.publisherTotal, 2)), 1);

  // Hız: listeye son 3 saatte girdiyse en yüksek; değilse trafik değişimi
  let velocity: number;
  if (!trend.current) velocity = 0;
  else if (trend.firstObservedAt >= hoursAgo(now, 3)) velocity = 1;
  else if (trend.previousTraffic && trend.approxTraffic) {
    const ratio = trend.approxTraffic / trend.previousTraffic;
    velocity = Math.min(Math.max(0.33 + (Math.log2(ratio) / Math.log2(3)) * 0.67, 0), 1);
  } else velocity = 0.33;

  const searchInterest = ctx.trendsAvailable
    ? trend.current
      ? trafficToNormalized(trend.approxTraffic)
      : 0
    : null;

  return {
    normalized: {
      search_interest: searchInterest === null ? null : round4(searchInterest),
      social: null,
      news_visibility: round4(newsVisibility),
      velocity: round4(velocity),
    },
    raw: {
      search_interest: trend.approxTraffic,
      social: null,
      news_visibility: newsSources,
      velocity: trend.previousTraffic,
    },
  };
}

/** Haber konusu skoru (aramada olmadığı için arama ilgisi 0; Trends verisi yoksa "bekleniyor") */
export function scoreCluster(
  items: ClusterInput[],
  now: Date,
  ctx: { publisherTotal: number; trendsAvailable: boolean },
): { normalized: ComponentInput; raw: Record<string, number | null> } {
  const recent6 = items.filter((i) => i.at >= hoursAgo(now, 6));
  const pub6 = distinctPublishers(recent6);
  const last1 = items.filter((i) => i.at >= hoursAgo(now, 1)).length;
  const prev3 = items.filter((i) => i.at >= hoursAgo(now, 4) && i.at < hoursAgo(now, 1)).length;

  const newsVisibility =
    pub6 === 0
      ? 0
      : Math.min(Math.log(1 + pub6) / Math.log(1 + Math.max(ctx.publisherTotal, 2)), 1);
  const ratio = last1 / Math.max(prev3 / 3, 1 / 3);
  const velocity = last1 === 0 ? 0 : Math.min(ratio / 3, 1);

  return {
    normalized: {
      search_interest: ctx.trendsAvailable ? 0 : null,
      social: null,
      news_visibility: round4(newsVisibility),
      velocity: round4(velocity),
    },
    raw: { search_interest: null, social: null, news_visibility: pub6, velocity: last1 },
  };
}

/** Trend konusu için ölçülen bilgiler (uydurma yok) */
export function trendReasons(trend: TrendInfo, newsItems: ClusterInput[], now: Date): string[] {
  const reasons: string[] = [];
  if (trend.current) {
    const traffic = trend.approxTraffic
      ? ` (yaklaşık ${trend.approxTraffic.toLocaleString("tr-TR")}+ arama)`
      : "";
    reasons.push(`Google’da Türkiye trend listesinde${traffic}`);
    const hours = Math.floor((now.getTime() - trend.firstObservedAt.getTime()) / 3_600_000);
    reasons.push(
      hours >= 1 ? `${hours} saattir trend listesinde` : "Son 1 saat içinde trend listesine girdi",
    );
  } else {
    reasons.push("Google’ın Türkiye trend listesinden çıktı");
  }
  const sources = distinctPublishers(newsItems) + new Set(trend.related.map((r) => r.source)).size;
  if (sources > 0) reasons.push(`${sources} haber kaynağında konuyla ilgili haber var`);
  return reasons;
}

/** Haber konusu için ölçülen bilgiler (uydurma yok) */
export function newsReasons(items: ClusterInput[], now: Date): string[] {
  const reasons = [`${distinctPublishers(items)} farklı haber kaynağında yer aldı`];
  const lastHour = items.filter((i) => i.at.getTime() >= now.getTime() - 3_600_000).length;
  if (lastHour > 0) reasons.push(`Son 1 saatte ${lastHour} yeni haber yayımlandı`);
  reasons.push("Google’ın Türkiye trend listesinde değil");
  return reasons;
}

export function nextNewsStatus(
  current: Status,
  ctx: { lastItemAt: Date; publishers: number; now: Date },
): Status {
  if (current === "hidden") return "hidden";
  const idleHours = (ctx.now.getTime() - ctx.lastItemAt.getTime()) / 3_600_000;
  if (idleHours > RULES.newsArchiveAfterHours) return "archived";
  const qualifies = ctx.publishers >= RULES.minPublishersToPublishNews;
  if (current === "candidate")
    return qualifies && idleHours <= RULES.newsCoolingAfterHours ? "published" : "candidate";
  if (idleHours > RULES.newsCoolingAfterHours) return "cooling";
  return "published";
}

export function nextTrendStatus(current: Status, trend: TrendInfo, now: Date): Status {
  if (current === "hidden") return "hidden";
  if (trend.current) return "published";
  const idleHours = (now.getTime() - trend.lastObservedAt.getTime()) / 3_600_000;
  return idleHours > RULES.trendArchiveAfterHours ? "archived" : "cooling";
}

/** Son 24 saatin trend gözlemlerini terim bazında derler */
export function compileTrends(
  rows: {
    term: string;
    approx_traffic: number | null;
    observed_at: Date;
    related: TrendInfo["related"];
  }[],
  now: Date,
  trendsAvailable: boolean,
): TrendInfo[] {
  const latestBatch = rows.reduce<number>((max, r) => Math.max(max, r.observed_at.getTime()), 0);
  const byKey = new Map<string, typeof rows>();
  for (const r of rows) {
    const key = trendKey(r.term);
    const list = byKey.get(key) ?? [];
    list.push(r);
    byKey.set(key, list);
  }
  const compareBefore = hoursAgo(now, RULES.trendCompareMinHours).getTime();
  const out: TrendInfo[] = [];
  for (const [key, list] of byKey) {
    list.sort((a, b) => a.observed_at.getTime() - b.observed_at.getTime());
    const last = list[list.length - 1]!;
    const previous = [...list].reverse().find((r) => r.observed_at.getTime() <= compareBefore);
    out.push({
      key,
      term: last.term,
      tokens: tokenize(last.term),
      approxTraffic: last.approx_traffic,
      // Güncel = en son başarılı çekmede (±5 dk) listede ve Trends verisi taze
      current: trendsAvailable && latestBatch - last.observed_at.getTime() <= 5 * 60_000,
      firstObservedAt: list[0]!.observed_at,
      lastObservedAt: last.observed_at,
      previousTraffic: previous?.approx_traffic ?? null,
      related: Array.isArray(last.related) ? last.related.slice(0, 5) : [],
    });
  }
  return out;
}

async function uniqueSlug(db: Database, title: string): Promise<string> {
  const base = slugify(title, 72);
  for (let i = 0; i < 5; i++) {
    const slug = `${base}-${randomBytes(2).toString("hex")}`;
    const [exists] = await db
      .select({ id: topics.id })
      .from(topics)
      .where(eq(topics.slug, slug))
      .limit(1);
    if (!exists) return slug;
  }
  return `${base}-${randomBytes(4).toString("hex")}`;
}

type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

async function hasEvent(
  tx: Tx,
  topicId: string,
  type: (typeof timelineEvents.$inferInsert)["type"],
) {
  const [row] = await tx
    .select({ id: timelineEvents.id })
    .from(timelineEvents)
    .where(and(eq(timelineEvents.topicId, topicId), eq(timelineEvents.type, type)))
    .limit(1);
  return !!row;
}

async function writeSnapshot(
  tx: Tx,
  topicId: string,
  now: Date,
  scored: { normalized: ComponentInput; raw: Record<string, number | null> },
) {
  const computed = computeScore(scored.normalized);
  const components: ScoreComponents = {};
  for (const key of COMPONENT_KEYS) {
    const c = computed.components[key];
    if (c) components[key] = { ...c, raw: c.available ? (scored.raw[key] ?? null) : null };
  }
  const [snapshot] = await tx
    .insert(topicSnapshots)
    .values({
      topicId,
      capturedAt: now,
      score: computed.score,
      components,
      signalsAvailable: computed.signalsAvailable,
      signalsTotal: computed.signalsTotal,
    })
    .onConflictDoNothing()
    .returning({ id: topicSnapshots.id });
  return snapshot ? { id: snapshot.id, score: computed.score } : null;
}

export async function buildTopics(deps: PipelineDeps): Promise<PipelineResult> {
  const { db, log } = deps;
  const now = deps.now?.() ?? new Date();
  const result: PipelineResult = {
    itemsInWindow: 0,
    clusters: 0,
    trends: 0,
    created: 0,
    snapshots: 0,
    published: 0,
    cooling: 0,
    archived: 0,
  };

  const conn = await deps.client.reserve();
  try {
    const [lock] = await conn`select pg_try_advisory_lock(hashtext('topics:build')) as ok`;
    if (!lock?.ok) return { ...result, skipped: "locked" };

    // ── Girdi 1: son 24 saatin haberleri; küme tohumu yalnızca HABER konusu bağlantıları ──
    const rows = await db.execute<{
      id: number;
      title: string;
      url: string;
      publisher_id: number | null;
      at: Date | string;
      topic_id: string | null;
    }>(sql`
      select si.id, si.title, si.url, si.publisher_id,
             coalesce(si.published_at, si.fetched_at) as at,
             nt.topic_id
      from source_items si
      left join lateral (
        select ti.topic_id from topic_items ti
        join topics t on t.id = ti.topic_id and t.kind = 'news' and t.is_mock = false
        where ti.source_item_id = si.id
        order by ti.added_at asc
        limit 1
      ) nt on true
      where si.is_mock = false
        and si.publisher_id is not null
        and coalesce(si.published_at, si.fetched_at) >= ${hoursAgo(now, RULES.windowHours).toISOString()}
        and coalesce(si.published_at, si.fetched_at) <= ${now.toISOString()}
    `);
    const items: ClusterInput[] = rows.map((r) => ({
      id: Number(r.id),
      title: r.title,
      url: r.url,
      publisherId: r.publisher_id,
      at: r.at instanceof Date ? r.at : new Date(r.at),
      topicId: r.topic_id,
    }));
    result.itemsInWindow = items.length;

    const [{ n: publisherTotal } = { n: 12 }] = await db.execute<{ n: number }>(
      sql`select count(*)::int as n from ${publishers} where is_active = true and is_mock = false`,
    );

    // ── Girdi 2: Trends (son 24 saat) ──
    const [trendsProvider] = await db
      .select({ id: dataProviders.id, lastSuccessAt: dataProviders.lastSuccessAt })
      .from(dataProviders)
      .where(eq(dataProviders.key, "google_trends"));
    const trendsAvailable =
      !!trendsProvider?.lastSuccessAt &&
      trendsProvider.lastSuccessAt >= hoursAgo(now, RULES.trendsFreshHours);
    const trendRows = trendsProvider
      ? await db.execute<{
          term: string;
          approx_traffic: number | null;
          observed_at: Date | string;
          related: TrendInfo["related"];
        }>(sql`
          select term, approx_traffic, observed_at, related from trend_signals
          where provider_id = ${trendsProvider.id}
            and observed_at >= ${hoursAgo(now, RULES.windowHours).toISOString()}
            and observed_at <= ${now.toISOString()}
        `)
      : [];
    const trends = compileTrends(
      trendRows.map((r) => ({
        ...r,
        observed_at: r.observed_at instanceof Date ? r.observed_at : new Date(r.observed_at),
      })),
      now,
      trendsAvailable,
    ).filter((t) => !isMediaTerm(t.term) && t.tokens.length > 0);

    const categoryIds = new Map(
      (await db.select({ id: categories.id, slug: categories.slug }).from(categories)).map((c) => [
        c.slug,
        c.id,
      ]),
    );
    const categoryId = (slug: string) => categoryIds.get(slug) ?? categoryIds.get("diger")!;

    const clusters = clusterItems(items);
    result.clusters = clusters.length;

    const processed = new Set<string>();
    const visible: {
      kind: "trend" | "news";
      snapshotId: number;
      topicId: string;
      score: number | null;
    }[] = [];
    const claimedClusters = new Set<Cluster>();

    // ══ 1) Trend konuları ══
    const existingTrendTopics = trends.length
      ? await db
          .select({
            id: topics.id,
            trendKey: topics.trendKey,
            status: topics.status,
            publishedAt: topics.publishedAt,
            summaryOrigin: topics.summaryOrigin,
            categoryId: topics.categoryId,
          })
          .from(topics)
          .where(
            and(
              eq(topics.kind, "trend"),
              eq(topics.isMock, false),
              inArray(
                topics.trendKey,
                trends.map((t) => t.key),
              ),
            ),
          )
      : [];
    const trendTopicByKey = new Map(existingTrendTopics.map((t) => [t.trendKey!, t]));

    for (const trend of trends) {
      const existing = trendTopicByKey.get(trend.key);
      // Listeden çıkmış ve hiç konu açılmamış terim için konu açılmaz
      if (!existing && !trend.current) continue;
      if (trend.current) result.trends++;

      const cluster = bestClusterForTrend(clusters, trend);
      if (cluster) claimedClusters.add(cluster);
      const newsItems = cluster?.items ?? [];

      await db.transaction(async (tx) => {
        let topicId = existing?.id;
        const current: Status = (existing?.status as Status | undefined) ?? "candidate";
        if (!topicId) {
          const title = displayTerm(trend.term);
          const [created] = await tx
            .insert(topics)
            .values({
              slug: await uniqueSlug(db, title),
              title,
              kind: "trend",
              trendKey: trend.key,
              categoryId: categoryId(
                inferCategory([...newsItems.map((i) => i.url), ...trend.related.map((r) => r.url)]),
              ),
              summary: null,
              reasons: [],
              status: "candidate",
              summaryOrigin: "none",
              isMock: false,
              firstSeenAt: trend.firstObservedAt,
            })
            .onConflictDoNothing()
            .returning({ id: topics.id });
          if (!created) return; // eşzamanlı başka bir çalıştırma oluşturdu
          topicId = created.id;
          result.created++;
          await tx
            .insert(timelineEvents)
            .values({ topicId, occurredAt: trend.firstObservedAt, type: "trend_listed" });
        }
        processed.add(topicId);

        // Açıklayıcı haberleri bağla: eşleşen küme + Google'ın ilgili haberleri
        if (newsItems.length) {
          await tx
            .insert(topicItems)
            .values(newsItems.map((i) => ({ topicId: topicId!, sourceItemId: i.id, addedAt: now })))
            .onConflictDoNothing();
        }
        if (trend.related.length && trendsProvider) {
          await tx
            .insert(sourceItems)
            .values(
              trend.related.map((r) => ({
                providerId: trendsProvider.id,
                publisherId: null,
                sourceName: r.source.slice(0, 96) || null,
                url: r.url,
                urlHash: urlHash(r.url),
                title: r.title.slice(0, 300),
                publishedAt: null,
                fetchedAt: trend.lastObservedAt,
              })),
            )
            .onConflictDoNothing({ target: sourceItems.urlHash });
          const relatedIds = await tx
            .select({ id: sourceItems.id })
            .from(sourceItems)
            .where(
              inArray(
                sourceItems.urlHash,
                trend.related.map((r) => urlHash(r.url)),
              ),
            );
          if (relatedIds.length) {
            await tx
              .insert(topicItems)
              .values(
                relatedIds.map((r) => ({ topicId: topicId!, sourceItemId: r.id, addedAt: now })),
              )
              .onConflictDoNothing();
          }
        }
        if (current === "hidden") return;

        const status = nextTrendStatus(current, trend, now);
        const categoryUpdate =
          existing && existing.categoryId === categoryId("diger")
            ? {
                categoryId: categoryId(
                  inferCategory([
                    ...newsItems.map((i) => i.url),
                    ...trend.related.map((r) => r.url),
                  ]),
                ),
              }
            : {};
        await tx
          .update(topics)
          .set({
            ...categoryUpdate,
            ...((existing?.summaryOrigin ?? "none") === "none"
              ? { reasons: trendReasons(trend, newsItems, now) }
              : {}),
            status,
            ...(status === "published" && !existing?.publishedAt ? { publishedAt: now } : {}),
            updatedAt: now,
          })
          .where(eq(topics.id, topicId));

        if (status === "archived") {
          result.archived++;
          return;
        }
        if (
          status === "cooling" &&
          current === "published" &&
          !(await hasEvent(tx, topicId, "trend_left"))
        ) {
          await tx
            .insert(timelineEvents)
            .values({ topicId, occurredAt: trend.lastObservedAt, type: "trend_left" });
        }
        if (distinctPublishers(newsItems) >= 3 && !(await hasEvent(tx, topicId, "news_spread"))) {
          await tx.insert(timelineEvents).values({ topicId, occurredAt: now, type: "news_spread" });
        }

        const snap = await writeSnapshot(
          tx,
          topicId,
          now,
          scoreTrend(trend, newsItems, now, { publisherTotal, trendsAvailable }),
        );
        if (snap) {
          result.snapshots++;
          visible.push({ kind: "trend", snapshotId: snap.id, topicId, score: snap.score });
        }
        if (status === "published") result.published++;
        if (status === "cooling") result.cooling++;
      });
    }

    // ══ 2) Haber konuları: hiçbir aramayla eşleşmeyen kümeler ══
    const newsIds = clusters.map((c) => c.topicId).filter((id): id is string => id !== null);
    const existingNews = newsIds.length
      ? await db
          .select({
            id: topics.id,
            status: topics.status,
            publishedAt: topics.publishedAt,
            summaryOrigin: topics.summaryOrigin,
          })
          .from(topics)
          .where(inArray(topics.id, newsIds))
      : [];
    const newsById = new Map(existingNews.map((t) => [t.id, t]));

    for (const cluster of clusters) {
      const publishersCount = distinctPublishers(cluster.items);
      const claimed = claimedClusters.has(cluster);
      if (!cluster.topicId && (claimed || publishersCount < RULES.minPublishersToCreate)) continue;

      const lastItemAt = cluster.items.reduce(
        (max, i) => (i.at > max ? i.at : max),
        cluster.items[0]!.at,
      );
      const firstItemAt = cluster.items.reduce(
        (min, i) => (i.at < min ? i.at : min),
        cluster.items[0]!.at,
      );

      await db.transaction(async (tx) => {
        let topicId = cluster.topicId;
        const existing = topicId ? newsById.get(topicId) : undefined;
        const current: Status = (existing?.status as Status | undefined) ?? "candidate";

        if (!topicId) {
          const title = calmTitle(representative(cluster).title);
          const [created] = await tx
            .insert(topics)
            .values({
              slug: await uniqueSlug(db, title),
              title,
              kind: "news",
              categoryId: categoryId(inferCategory(cluster.items.map((i) => i.url))),
              summary: null,
              reasons: [],
              status: "candidate",
              summaryOrigin: "none",
              isMock: false,
              firstSeenAt: firstItemAt,
            })
            .returning({ id: topics.id });
          topicId = created!.id;
          result.created++;
          await tx.insert(timelineEvents).values({
            topicId,
            occurredAt: firstItemAt,
            type: "first_source",
            sourceItemId:
              cluster.items.find((i) => i.at.getTime() === firstItemAt.getTime())?.id ?? null,
          });
        }
        processed.add(topicId);

        const newLinks = cluster.items.filter((i) => i.topicId === null);
        if (newLinks.length) {
          await tx
            .insert(topicItems)
            .values(newLinks.map((i) => ({ topicId: topicId!, sourceItemId: i.id, addedAt: now })))
            .onConflictDoNothing();
        }
        if (current === "hidden") return;

        // Bir aramayla eşleşen küme artık trend konusunda gösterilir; haber konusu geri çekilir
        const status: Status = claimed
          ? current === "candidate"
            ? "candidate"
            : "archived"
          : nextNewsStatus(current, { lastItemAt, publishers: publishersCount, now });

        const candidateUpdates =
          current === "candidate"
            ? {
                title: calmTitle(representative(cluster).title),
                categoryId: categoryId(inferCategory(cluster.items.map((i) => i.url))),
              }
            : {};
        await tx
          .update(topics)
          .set({
            ...candidateUpdates,
            ...((existing?.summaryOrigin ?? "none") === "none"
              ? { reasons: newsReasons(cluster.items, now) }
              : {}),
            status,
            ...(status === "published" && !existing?.publishedAt ? { publishedAt: now } : {}),
            updatedAt: now,
          })
          .where(eq(topics.id, topicId));
        if (status === "archived") {
          result.archived++;
          return;
        }
        if (status === "candidate") return;

        if (publishersCount >= 3 && !(await hasEvent(tx, topicId, "news_spread"))) {
          const sorted = [...cluster.items].sort((a, b) => a.at.getTime() - b.at.getTime());
          const seen = new Set<number | null>();
          const third = sorted.find((i) => (seen.add(i.publisherId), seen.size === 3));
          await tx.insert(timelineEvents).values({
            topicId,
            occurredAt: third?.at ?? now,
            type: "news_spread",
            sourceItemId: third?.id ?? null,
          });
        }
        const snap = await writeSnapshot(
          tx,
          topicId,
          now,
          scoreCluster(cluster.items, now, { publisherTotal, trendsAvailable }),
        );
        if (snap) {
          result.snapshots++;
          visible.push({ kind: "news", snapshotId: snap.id, topicId, score: snap.score });
        }
        if (status === "published") result.published++;
        if (status === "cooling") result.cooling++;
      });
    }

    // ══ 3) Bu çalıştırmada hiç verisi kalmamış konular arşive ══
    const stale = await db
      .update(topics)
      .set({ status: "archived", updatedAt: now })
      .where(
        and(
          eq(topics.isMock, false),
          inArray(topics.status, ["candidate", "published", "cooling"]),
          processed.size ? notInArray(topics.id, [...processed]) : sql`true`,
        ),
      )
      .returning({ id: topics.id });
    result.archived += stale.length;

    // ══ 4) Sıralama (tür bazında) ve "ilk 5'e girdi" ══
    for (const kind of ["trend", "news"] as const) {
      const ranked = visible
        .filter((s) => s.kind === kind && s.score !== null)
        .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
      for (const [i, s] of ranked.entries()) {
        const rank = i + 1;
        await db.update(topicSnapshots).set({ rank }).where(eq(topicSnapshots.id, s.snapshotId));
        if (kind === "trend" && rank <= 5) {
          const [had] = await db
            .select({ id: timelineEvents.id })
            .from(timelineEvents)
            .where(
              and(eq(timelineEvents.topicId, s.topicId), eq(timelineEvents.type, "entered_top5")),
            )
            .limit(1);
          if (!had)
            await db
              .insert(timelineEvents)
              .values({ topicId: s.topicId, occurredAt: now, type: "entered_top5" });
        }
      }
    }

    log.info(result, "gündem konuları güncellendi");
    return result;
  } finally {
    await conn`select pg_advisory_unlock(hashtext('topics:build'))`.catch(() => {});
    conn.release();
  }
}
