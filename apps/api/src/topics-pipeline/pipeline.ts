// Ham veriden gündem konusu üretir: gruplama → konu oluşturma/güncelleme → skor → snapshot →
// yaşam döngüsü → zaman çizelgesi. Yapay zekâ KULLANILMAZ; konu başlığı kaynak başlıklarından
// seçilir, özet üretilmez (uydurma içerik yok). Örnek (mock) konulara dokunulmaz.
import { randomBytes } from "node:crypto";
import { and, eq, inArray, notInArray, sql } from "drizzle-orm";
import {
  categories,
  dataProviders,
  publishers,
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
import type { Logger } from "../ingest/types.ts";
import { inferCategory } from "./category.ts";
import {
  clusterItems,
  distinctPublishers,
  representative,
  type Cluster,
  type ClusterInput,
} from "./cluster.ts";
import { calmTitle, slugify, tokenize } from "./text.ts";

/** Konu oluşturma ve yaşam döngüsü eşikleri */
export const RULES = {
  windowHours: 24,
  /** Konu kaydı için en az farklı yayıncı */
  minPublishersToCreate: 2,
  /** Sitede yayına girmek için en az farklı yayıncı (Trends eşleşmesi varsa 2 yeter) */
  minPublishersToPublish: 3,
  /** Bu süredir yeni haber yoksa "soğuyan" */
  coolingAfterHours: 6,
  /** Bu süredir yeni haber yoksa arşiv */
  archiveAfterHours: 24,
  /** Trends verisi bu kadar eskiyse "veri yok" sayılır */
  trendsFreshHours: 2,
  /** Bir trend teriminin kümeyle eşleşmesi için terimi içeren başlık oranı */
  trendMatchRatio: 0.3,
} as const;

export interface PipelineResult {
  skipped?: "locked";
  itemsInWindow: number;
  clusters: number;
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

interface TrendObservation {
  term: string;
  tokens: string[];
  approxTraffic: number | null;
}

/**
 * "Neden gündemde?" maddeleri YALNIZCA ölçülen veriden üretilir (uydurma yok):
 * kaç kaynakta geçtiği, son saatteki haber sayısı, eşleşen arama trendi.
 */
export function factualReasons(
  items: ClusterInput[],
  now: Date,
  trend: { term: string; approxTraffic: number | null } | null,
): string[] {
  const reasons: string[] = [];
  const publishers = distinctPublishers(items);
  reasons.push(`${publishers} farklı haber kaynağında yer aldı`);
  const lastHour = items.filter((i) => i.at.getTime() >= now.getTime() - 3_600_000).length;
  if (lastHour > 0) reasons.push(`Son 1 saatte ${lastHour} yeni haber yayımlandı`);
  if (trend) {
    const traffic = trend.approxTraffic
      ? ` (yaklaşık ${trend.approxTraffic.toLocaleString("tr-TR")}+ arama)`
      : "";
    reasons.push(`Google’da “${trend.term}” araması Türkiye trend listesinde${traffic}`);
  }
  return reasons;
}

const hoursAgo = (now: Date, h: number) => new Date(now.getTime() - h * 3_600_000);

/** Arama ilgisi: log ölçek, 1 milyon arama ≈ 1.0; trafik bilinmiyorsa 0.5 */
function trafficToNormalized(traffic: number | null): number {
  if (traffic === null || traffic <= 0) return 0.5;
  return Math.min(Math.log10(traffic) / 6, 1);
}

function matchTrend(cluster: Cluster, trends: TrendObservation[]): TrendObservation | null {
  let best: TrendObservation | null = null;
  let bestRatio = 0;
  for (const trend of trends) {
    if (trend.tokens.length === 0) continue;
    const hits = cluster.items.filter((i) => {
      const tokens = new Set(tokenize(i.title));
      return trend.tokens.every((t) => tokens.has(t));
    }).length;
    const ratio = hits / cluster.items.length;
    if (ratio >= RULES.trendMatchRatio && ratio > bestRatio) {
      best = trend;
      bestRatio = ratio;
    }
  }
  return best;
}

export function scoreCluster(
  items: ClusterInput[],
  now: Date,
  ctx: { publisherTotal: number; trendsAvailable: boolean; trend: TrendObservation | null },
): { normalized: ComponentInput; raw: Record<string, number | null> } {
  const recent6 = items.filter((i) => i.at >= hoursAgo(now, 6));
  const pub6 = distinctPublishers(recent6);
  const last1 = items.filter((i) => i.at >= hoursAgo(now, 1)).length;
  const prev3 = items.filter((i) => i.at >= hoursAgo(now, 4) && i.at < hoursAgo(now, 1)).length;

  // Haber görünürlüğü: farklı yayıncı sayısı (log ölçek, tüm aktif yayıncılara göre)
  const newsVisibility =
    pub6 === 0
      ? 0
      : Math.min(Math.log(1 + pub6) / Math.log(1 + Math.max(ctx.publisherTotal, 2)), 1);
  // Yükselme hızı: son 1 saatteki haber / önceki 3 saatin saatlik ortalaması
  const ratio = last1 / Math.max(prev3 / 3, 1 / 3);
  const velocity = last1 === 0 ? 0 : Math.min(ratio / 3, 1);
  // Arama ilgisi: Trends verisi varsa eşleşme yoksa 0; veri hiç yoksa "bekleniyor"
  const searchInterest = ctx.trendsAvailable
    ? ctx.trend
      ? trafficToNormalized(ctx.trend.approxTraffic)
      : 0
    : null;

  return {
    normalized: {
      news_visibility: Number(newsVisibility.toFixed(4)),
      velocity: Number(velocity.toFixed(4)),
      search_interest: searchInterest === null ? null : Number(searchInterest.toFixed(4)),
      social: null,
    },
    raw: {
      news_visibility: pub6,
      velocity: last1,
      search_interest: ctx.trend?.approxTraffic ?? null,
      social: null,
    },
  };
}

export function nextStatus(
  current: Status,
  ctx: { lastItemAt: Date; publishers: number; trendMatched: boolean; now: Date },
): Status {
  if (current === "hidden") return "hidden";
  const idleHours = (ctx.now.getTime() - ctx.lastItemAt.getTime()) / 3_600_000;
  if (idleHours > RULES.archiveAfterHours) return "archived";
  const qualifies =
    ctx.publishers >= RULES.minPublishersToPublish ||
    (ctx.trendMatched && ctx.publishers >= RULES.minPublishersToCreate);
  if (current === "candidate")
    return qualifies && idleHours <= RULES.coolingAfterHours ? "published" : "candidate";
  if (idleHours > RULES.coolingAfterHours) return "cooling";
  return "published";
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

export async function buildTopics(deps: PipelineDeps): Promise<PipelineResult> {
  const { db, log } = deps;
  const now = deps.now?.() ?? new Date();
  const result: PipelineResult = {
    itemsInWindow: 0,
    clusters: 0,
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

    // ── Girdi: son 24 saatin gerçek haberleri (+ bağlı oldukları konu) ──
    const rows = await db.execute<{
      id: number;
      title: string;
      url: string;
      publisher_id: number | null;
      at: Date | string;
      topic_id: string | null;
    }>(sql`
      select distinct on (si.id)
             si.id, si.title, si.url, si.publisher_id,
             coalesce(si.published_at, si.fetched_at) as at,
             ti.topic_id
      from source_items si
      left join topic_items ti on ti.source_item_id = si.id
      left join topics t on t.id = ti.topic_id
      where si.is_mock = false
        and si.publisher_id is not null
        and coalesce(si.published_at, si.fetched_at) >= ${hoursAgo(now, RULES.windowHours).toISOString()}
        and coalesce(si.published_at, si.fetched_at) <= ${now.toISOString()}
        and (t.id is null or t.is_mock = false)
      order by si.id, ti.added_at asc nulls last
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

    // ── Trends: güncel mi, son 3 saatin terimleri ──
    const [trendsProvider] = await db
      .select({ id: dataProviders.id, lastSuccessAt: dataProviders.lastSuccessAt })
      .from(dataProviders)
      .where(eq(dataProviders.key, "google_trends"));
    const trendsAvailable =
      !!trendsProvider?.lastSuccessAt &&
      trendsProvider.lastSuccessAt >= hoursAgo(now, RULES.trendsFreshHours);
    const trendRows = trendsAvailable
      ? await db.execute<{ term: string; approx_traffic: number | null }>(sql`
          select distinct on (term) term, approx_traffic
          from trend_signals
          where observed_at >= ${hoursAgo(now, 3).toISOString()}
          order by term, observed_at desc
        `)
      : [];
    const trends: TrendObservation[] = trendRows.map((t) => ({
      term: t.term,
      tokens: tokenize(t.term),
      approxTraffic: t.approx_traffic,
    }));

    const categoryIds = new Map(
      (await db.select({ id: categories.id, slug: categories.slug }).from(categories)).map((c) => [
        c.slug,
        c.id,
      ]),
    );

    // ── Gruplama ──
    const clusters = clusterItems(items);
    result.clusters = clusters.length;

    const existingIds = clusters.map((c) => c.topicId).filter((id): id is string => id !== null);
    const existing = existingIds.length
      ? await db
          .select({
            id: topics.id,
            status: topics.status,
            publishedAt: topics.publishedAt,
            summaryOrigin: topics.summaryOrigin,
          })
          .from(topics)
          .where(inArray(topics.id, existingIds))
      : [];
    const existingById = new Map(existing.map((t) => [t.id, t]));

    const processed = new Set<string>();
    const visibleSnapshots: { snapshotId: number; topicId: string; score: number | null }[] = [];

    for (const cluster of clusters) {
      const publishersCount = distinctPublishers(cluster.items);
      if (!cluster.topicId && publishersCount < RULES.minPublishersToCreate) continue;

      const trend = matchTrend(cluster, trends);
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
        let current: Status = "candidate";
        let publishedAt: Date | null = null;
        let summaryOrigin: "none" | "manual" | "ai" = "none";

        if (!topicId) {
          const rep = representative(cluster);
          const title = calmTitle(rep.title);
          const categorySlug = inferCategory(cluster.items.map((i) => i.url));
          const [created] = await tx
            .insert(topics)
            .values({
              slug: await uniqueSlug(db, title),
              title,
              categoryId: categoryIds.get(categorySlug) ?? categoryIds.get("diger")!,
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
        } else {
          const t = existingById.get(topicId);
          current = (t?.status as Status) ?? "candidate";
          publishedAt = t?.publishedAt ?? null;
          summaryOrigin = t?.summaryOrigin ?? "none";
        }
        processed.add(topicId);

        // Yeni haberleri konuya bağla
        const newLinks = cluster.items.filter((i) => i.topicId === null);
        if (newLinks.length) {
          await tx
            .insert(topicItems)
            .values(newLinks.map((i) => ({ topicId: topicId!, sourceItemId: i.id, addedAt: now })))
            .onConflictDoNothing();
        }
        if (current === "hidden") return; // admin gizlediyse yalnızca bağlantılar güncellenir

        const status = nextStatus(current, {
          lastItemAt,
          publishers: publishersCount,
          trendMatched: !!trend,
          now,
        });

        // Aday konu yayına girene kadar başlık ve kategori güncellenebilir; sonra sabit kalır (URL/başlık istikrarı)
        const candidateUpdates =
          current === "candidate"
            ? {
                title: calmTitle(representative(cluster).title),
                categoryId:
                  categoryIds.get(inferCategory(cluster.items.map((i) => i.url))) ??
                  categoryIds.get("diger")!,
              }
            : {};
        await tx
          .update(topics)
          .set({
            ...candidateUpdates,
            // Editör/AI özeti olan konularda maddelere dokunulmaz
            ...(summaryOrigin === "none"
              ? { reasons: factualReasons(cluster.items, now, trend) }
              : {}),
            status,
            ...(status === "published" && !publishedAt ? { publishedAt: now } : {}),
            updatedAt: now,
          })
          .where(eq(topics.id, topicId));
        if (status === "archived") {
          result.archived++;
          return;
        }

        // Skor + snapshot
        const { normalized, raw } = scoreCluster(cluster.items, now, {
          publisherTotal,
          trendsAvailable,
          trend,
        });
        const computed = computeScore(normalized);
        const components: ScoreComponents = {};
        for (const key of COMPONENT_KEYS) {
          const c = computed.components[key];
          if (c) components[key] = { ...c, raw: c.available ? (raw[key] ?? null) : null };
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
        if (snapshot) result.snapshots++;
        if (status === "published") result.published++;
        if (status === "cooling") result.cooling++;
        if (snapshot && (status === "published" || status === "cooling")) {
          visibleSnapshots.push({ snapshotId: snapshot.id, topicId, score: computed.score });
        }

        // Zaman çizelgesi: yalnızca gerçek olaylar, her tür bir kez
        const had = new Set(
          (
            await tx
              .select({ type: timelineEvents.type })
              .from(timelineEvents)
              .where(eq(timelineEvents.topicId, topicId))
          ).map((e) => e.type),
        );
        if (!had.has("news_spread") && publishersCount >= RULES.minPublishersToPublish) {
          const sorted = [...cluster.items].sort((a, b) => a.at.getTime() - b.at.getTime());
          const seen = new Set<number | null>();
          const third = sorted.find(
            (i) => (seen.add(i.publisherId), seen.size === RULES.minPublishersToPublish),
          );
          await tx.insert(timelineEvents).values({
            topicId,
            occurredAt: third?.at ?? now,
            type: "news_spread",
            sourceItemId: third?.id ?? null,
          });
        }
        if (!had.has("search_spike") && trend) {
          await tx
            .insert(timelineEvents)
            .values({ topicId, occurredAt: now, type: "search_spike" });
        }
      });
    }

    // ── Bu çalıştırmada hiç haberi kalmamış görünür konular arşive ──
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

    // ── Sıralama ve "ilk 5'e girdi" ──
    const ranked = visibleSnapshots
      .filter((s) => s.score !== null)
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
    for (const [i, s] of ranked.entries()) {
      const rank = i + 1;
      await db.update(topicSnapshots).set({ rank }).where(eq(topicSnapshots.id, s.snapshotId));
      if (rank <= 5) {
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

    log.info(result, "gündem konuları güncellendi");
    return result;
  } finally {
    await conn`select pg_advisory_unlock(hashtext('topics:build'))`.catch(() => {});
    conn.release();
  }
}
