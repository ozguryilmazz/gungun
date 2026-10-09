// Veritabanı erişimi. Tüm sorgular Drizzle `sql` şablonuyla PARAMETRELİ gönderilir;
// kullanıcı girdisi hiçbir zaman SQL metnine eklenmez.
import { sql } from "drizzle-orm";
import type { Database } from "@gundemci/db";
import type { ScoreComponents } from "@gundemci/shared";
import { headlineExplainsTerm } from "../../topics-pipeline/pipeline.ts";
import type { StoryItem } from "../../topics-pipeline/stories.ts";

export interface SnapshotRef {
  capturedAt: Date;
  score: number | null;
}

export interface TopicRow {
  slug: string;
  title: string;
  kind: "trend" | "news";
  /** Konuya bağlı en güncel haber başlığı (kaynağıyla) */
  headline: { title: string; source: string; url: string } | null;
  categorySlug: string;
  categoryName: string;
  summary: string | null;
  isMock: boolean;
  topicUpdatedAt: Date;
  firstSeenAt: Date;
  latest: (SnapshotRef & { signalsAvailable: number; signalsTotal: number }) | null;
  previous: SnapshotRef | null;
  sourceCount: number;
  /** Google'ın yaklaşık arama sayısı + listede geçen süre (yalnızca şu an listedeki trend konuları) */
  searchVolume: { approxTraffic: number; sinceHours: number } | null;
  /** Son 24 saatin saatlik skorları (eskiden yeniye) */
  sparkline: number[];
  /**
   * Karşılaştırma sırası: ~1 saat önceki listede kaçıncıydı. "none": son 24 saatte listede hiç
   * yoktu (yeni giriş); null: karşılaştırılacak yakın ölçüm yok.
   */
  previousRank: number | "none" | null;
}

export interface TopicDetailRow extends TopicRow {
  isArchived: boolean;
  reasons: string[];
  summaryOrigin: "none" | "manual" | "ai";
  components: ScoreComponents;
  timeline: { type: string; occurredAt: Date }[];
  sources: { title: string; url: string; publisherName: string | null; publishedAt: Date | null }[];
}

export interface ProviderRow {
  key: string;
  kind: "trend" | "news" | "social" | "manual";
  name: string;
  isEnabled: boolean;
  config: Record<string, unknown>;
  lastSuccessAt: Date | null;
  lastErrorAt: Date | null;
  consecutiveFailures: number;
}

export interface YoutubeRow {
  rank: number;
  videoId: string;
  title: string;
  channelTitle: string;
  thumbnailUrl: string | null;
  viewCount: number | null;
  publishedAt: Date | null;
  observedAt: Date;
}

/** Ortak haber: en az 3 sitede yayımlanan haber; her site için ilk haberi */
export interface StoryRow {
  id: number;
  title: string;
  publisherCount: number;
  firstItemAt: Date;
  listedAt: Date;
  lastGrowthAt: Date | null;
  lastGrowthBy: number | null;
  sources: { publisherName: string; url: string; publishedAt: Date }[];
}

export interface ArchiveRow {
  slug: string;
  title: string;
  categorySlug: string;
  categoryName: string;
  peakScore: number | null;
  firstSeenAt: Date;
  sourceCount: number;
  isMock: boolean;
}

export interface TopicRepository {
  listVisibleTopics(windowMinutes: number, kind: "trend" | "news"): Promise<TopicRow[]>;
  getTopicDetail(slug: string, windowMinutes: number): Promise<TopicDetailRow | null>;
  getTopicHistory(slug: string, since: Date): Promise<SnapshotRef[] | null>;
  listProviders(): Promise<ProviderRow[]>;
  /** [start, end) aralığında skor kaydı olan, yayına girmiş konular — en yüksek skora göre */
  archiveDay(start: Date, end: Date): Promise<ArchiveRow[]>;
  /** Arşivde konusu olan son günler (İstanbul saatine göre) */
  archiveDays(limit: number): Promise<{ date: string; topicCount: number }[]>;
  /** `since` sonrasındaki EN SON YouTube trend listesi, sıraya göre */
  latestYoutube(since: Date, limit: number): Promise<YoutubeRow[]>;
  /** İlk haberi `since` sonrasında olan ortak haberler: site sayısına göre, en fazla `limit` */
  listStories(since: Date, limit: number): Promise<StoryRow[]>;
  /** Tek ortak haber ve ona bağlı tüm haberler (en fazla 200); yoksa null */
  getStory(id: number): Promise<{ story: Omit<StoryRow, "sources">; items: StoryItem[] } | null>;
  ping(): Promise<void>;
}

const VISIBLE_STATUSES = sql`('published', 'cooling')`;
/** Detay sayfası arşivlenmiş konular için de açılır (arşiv bağlantıları kırılmasın) */
const DETAIL_STATUSES = sql`('published', 'cooling', 'archived')`;
/** Arşive yalnızca bir kez yayına girmiş (veya örnek) konular girer; gizlenenler asla */
const ARCHIVE_FILTER = sql`t.status <> 'hidden' and (t.published_at is not null or t.is_mock = true)`;
const MAX_TOPICS = 500;
const MAX_SOURCES = 50;

type RawTopic = {
  id: string;
  slug: string;
  title: string;
  kind: "trend" | "news";
  trend_term: string | null;
  h_candidates: { title: string; source: string | null; url: string }[] | null;
  category_slug: string;
  category_name: string;
  summary: string | null;
  is_mock: boolean;
  updated_at: Date;
  first_seen_at: Date;
  latest_at: Date | null;
  latest_score: number | null;
  signals_available: number | null;
  signals_total: number | null;
  latest_components: ScoreComponents | null;
  sparkline: (number | string)[] | null;
  pr_rank: number | null;
  pr_at: Date | string | null;
  prev_at: Date | null;
  prev_score: number | null;
  source_count: number;
  reasons?: string[];
  summary_origin?: "none" | "manual" | "ai";
  status?: string;
};

const asDate = (v: Date | string) => (v instanceof Date ? v : new Date(v));

/**
 * Kartta gösterilecek başlık: en güncel haber. Trend konularında başlığında aranan terim geçen
 * ilk haber seçilir (Google'ın bazen alakasız eşleştirdiği haberler gösterilmez).
 */
export function pickHeadline(
  candidates: { title: string; source: string | null; url: string }[],
  trendTerm: string | null,
): TopicRow["headline"] {
  const pick = trendTerm
    ? candidates.find((c) => headlineExplainsTerm(c.title, trendTerm))
    : candidates[0];
  return pick
    ? { title: pick.title, source: pick.source ?? "Bilinmeyen kaynak", url: pick.url }
    : null;
}

function mapTopic(r: RawTopic): TopicRow {
  return {
    slug: r.slug,
    title: r.title,
    kind: r.kind,
    headline: pickHeadline(r.h_candidates ?? [], r.kind === "trend" ? r.trend_term : null),
    categorySlug: r.category_slug,
    categoryName: r.category_name,
    summary: r.summary,
    isMock: r.is_mock,
    topicUpdatedAt: asDate(r.updated_at),
    firstSeenAt: asDate(r.first_seen_at),
    latest:
      r.latest_at === null
        ? null
        : {
            capturedAt: asDate(r.latest_at),
            score: r.latest_score,
            signalsAvailable: r.signals_available ?? 0,
            signalsTotal: r.signals_total ?? 0,
          },
    previous: r.prev_at === null ? null : { capturedAt: asDate(r.prev_at), score: r.prev_score },
    sourceCount: Number(r.source_count),
    searchVolume: searchVolume(r),
    previousRank: previousRank(r),
    sparkline: (r.sparkline ?? [])
      .map(Number)
      .filter((n) => Number.isInteger(n) && n >= 0 && n <= 100)
      .slice(-25),
  };
}

/** Karşılaştırma ölçümü 2 saatten eskiyse (ör. sistem bir süre kapalıydı) değişim gösterilmez */
function previousRank(r: RawTopic): TopicRow["previousRank"] {
  if (r.latest_at === null) return null;
  if (r.pr_at === null || r.pr_rank === null) return "none";
  const gapMin = (asDate(r.latest_at).getTime() - asDate(r.pr_at).getTime()) / 60_000;
  return gapMin <= 120 ? Number(r.pr_rank) : null;
}

/** Son skor kaydındaki arama ilgisi: ham değer Google'ın yaklaşık arama sayısıdır */
function searchVolume(r: RawTopic): TopicRow["searchVolume"] {
  const c = r.latest_components?.search_interest;
  if (r.kind !== "trend" || r.latest_at === null || !c?.available) return null;
  // Listeden çıkmış aramanın arama ilgisi 0'dır: eski sayı "şu an" gibi gösterilmez
  if (!c.normalized || c.normalized <= 0 || !c.raw || c.raw <= 0) return null;
  const hours = Math.floor(
    (asDate(r.latest_at).getTime() - asDate(r.first_seen_at).getTime()) / 3_600_000,
  );
  return { approxTraffic: Math.round(c.raw), sinceHours: Math.max(hours, 0) };
}

/** Konu + en son snapshot + karşılaştırma snapshot'ı + kaynak sayısı */
function topicSelect(windowMinutes: number) {
  return sql`
    select t.id, t.slug, t.title, t.kind, t.summary, t.is_mock, t.updated_at, t.first_seen_at,
           t.trend_key as trend_term, h.h_candidates,
           t.reasons, t.summary_origin, t.status,
           c.slug as category_slug, c.name as category_name,
           l.captured_at as latest_at, l.score as latest_score,
           l.signals_available, l.signals_total, l.components as latest_components,
           p.captured_at as prev_at, p.score as prev_score,
           (select count(*)::int from topic_items ti where ti.topic_id = t.id) as source_count,
           sp.sparkline, pr.rank as pr_rank, pr.captured_at as pr_at
    from topics t
    join categories c on c.id = t.category_id
    left join lateral (
      select s.captured_at, s.score, s.signals_available, s.signals_total, s.components
      from topic_snapshots s
      where s.topic_id = t.id
      order by s.captured_at desc
      limit 1
    ) l on true
    left join lateral (
      select s.captured_at, s.score
      from topic_snapshots s
      where s.topic_id = t.id
        and s.captured_at <= l.captured_at - (${windowMinutes}::int * interval '1 minute')
      order by s.captured_at desc
      limit 1
    ) p on true
    left join lateral (
      -- Sıra değişimi: ~1 saat (en az 50 dk) önceki, listede sıra almış son ölçüm (son 24 saat)
      select s.rank, s.captured_at
      from topic_snapshots s
      where s.topic_id = t.id
        and s.rank is not null
        and s.captured_at <= l.captured_at - interval '50 minutes'
        and s.captured_at >= l.captured_at - interval '24 hours'
      order by s.captured_at desc
      limit 1
    ) pr on true
    left join lateral (
      -- Mini grafik: son 24 saatte her saatin son skoru
      select json_agg(x.score order by x.hour) as sparkline
      from (
        select distinct on (date_trunc('hour', s.captured_at))
               date_trunc('hour', s.captured_at) as hour, s.score
        from topic_snapshots s
        where s.topic_id = t.id
          and s.score is not null
          and s.captured_at > l.captured_at - interval '24 hours'
        order by date_trunc('hour', s.captured_at), s.captured_at desc
      ) x
    ) sp on true
    left join lateral (
      select json_agg(json_build_object('title', x.title, 'source', x.source, 'url', x.url)) as h_candidates
      from (
        select si.title, coalesce(pub.name, si.source_name) as source, si.url
        from topic_items ti
        join source_items si on si.id = ti.source_item_id
        left join publishers pub on pub.id = si.publisher_id
        where ti.topic_id = t.id
        order by coalesce(si.published_at, si.fetched_at) desc nulls last, si.id desc
        limit 10
      ) x
    ) h on true
  `;
}

export function createTopicRepository(db: Database): TopicRepository {
  return {
    async listVisibleTopics(windowMinutes, kind) {
      const rows = await db.execute<RawTopic>(sql`
        ${topicSelect(windowMinutes)}
        where t.status in ${VISIBLE_STATUSES} and t.kind = ${kind}
        limit ${MAX_TOPICS}
      `);
      return rows.map(mapTopic);
    },

    async getTopicDetail(slug, windowMinutes) {
      const rows = await db.execute<RawTopic>(sql`
        ${topicSelect(windowMinutes)}
        where t.slug = ${slug} and t.status in ${DETAIL_STATUSES}
        limit 1
      `);
      const raw = rows[0];
      if (!raw) return null;

      const [timeline, sources] = await Promise.all([
        db.execute<{ type: string; occurred_at: Date }>(sql`
          select type, occurred_at from timeline_events
          where topic_id = ${raw.id}
          order by occurred_at asc
          limit 50
        `),
        db.execute<{
          title: string;
          url: string;
          publisher_name: string | null;
          published_at: Date | null;
        }>(sql`
          select si.title, si.url, coalesce(p.name, si.source_name) as publisher_name, si.published_at
          from topic_items ti
          join source_items si on si.id = ti.source_item_id
          left join publishers p on p.id = si.publisher_id
          where ti.topic_id = ${raw.id}
          order by si.published_at asc nulls last, si.id asc
          limit ${MAX_SOURCES}
        `),
      ]);

      return {
        ...mapTopic(raw),
        isArchived: raw.status === "archived",
        reasons: Array.isArray(raw.reasons) ? raw.reasons : [],
        summaryOrigin: raw.summary_origin ?? "none",
        components: raw.latest_components ?? {},
        timeline: timeline.map((e) => ({ type: e.type, occurredAt: asDate(e.occurred_at) })),
        sources: sources.map((s) => ({
          title: s.title,
          url: s.url,
          publisherName: s.publisher_name,
          publishedAt: s.published_at === null ? null : asDate(s.published_at),
        })),
      };
    },

    async getTopicHistory(slug, since) {
      const topic = await db.execute<{ id: string }>(sql`
        select id from topics where slug = ${slug} and status in ${DETAIL_STATUSES} limit 1
      `);
      const id = topic[0]?.id;
      if (!id) return null;
      const rows = await db.execute<{ captured_at: Date; score: number | null }>(sql`
        select captured_at, score from topic_snapshots
        where topic_id = ${id} and captured_at >= ${since.toISOString()}
        order by captured_at asc
        limit 500
      `);
      return rows.map((r) => ({ capturedAt: asDate(r.captured_at), score: r.score }));
    },

    async listProviders() {
      const rows = await db.execute<{
        key: string;
        kind: ProviderRow["kind"];
        name: string;
        is_enabled: boolean;
        config: Record<string, unknown>;
        last_success_at: Date | null;
        last_error_at: Date | null;
        consecutive_failures: number;
      }>(sql`
        select key, kind, name, is_enabled, config, last_success_at, last_error_at, consecutive_failures
        from data_providers
        order by id asc
      `);
      return rows.map((r) => ({
        key: r.key,
        kind: r.kind,
        name: r.name,
        isEnabled: r.is_enabled,
        config: r.config ?? {},
        lastSuccessAt: r.last_success_at === null ? null : asDate(r.last_success_at),
        lastErrorAt: r.last_error_at === null ? null : asDate(r.last_error_at),
        consecutiveFailures: r.consecutive_failures,
      }));
    },

    async archiveDay(start, end) {
      const rows = await db.execute<{
        slug: string;
        title: string;
        category_slug: string;
        category_name: string;
        peak: number | null;
        first_seen_at: Date;
        source_count: number;
        is_mock: boolean;
      }>(sql`
        select t.slug, t.title, c.slug as category_slug, c.name as category_name,
               max(s.score) as peak, t.first_seen_at, t.is_mock,
               (select count(*)::int from topic_items ti where ti.topic_id = t.id) as source_count
        from topic_snapshots s
        join topics t on t.id = s.topic_id
        join categories c on c.id = t.category_id
        where s.captured_at >= ${start.toISOString()} and s.captured_at < ${end.toISOString()}
          and ${ARCHIVE_FILTER}
        group by t.id, c.slug, c.name
        order by peak desc nulls last, t.first_seen_at asc
        limit 50
      `);
      return rows.map((r) => ({
        slug: r.slug,
        title: r.title,
        categorySlug: r.category_slug,
        categoryName: r.category_name,
        peakScore: r.peak,
        firstSeenAt: asDate(r.first_seen_at),
        sourceCount: Number(r.source_count),
        isMock: r.is_mock,
      }));
    },

    async archiveDays(limit) {
      const rows = await db.execute<{ day: string; n: number }>(sql`
        select to_char((s.captured_at at time zone 'Europe/Istanbul')::date, 'YYYY-MM-DD') as day,
               count(distinct s.topic_id)::int as n
        from topic_snapshots s
        join topics t on t.id = s.topic_id
        where ${ARCHIVE_FILTER}
        group by day
        order by day desc
        limit ${limit}
      `);
      return rows.map((r) => ({ date: r.day, topicCount: Number(r.n) }));
    },

    async latestYoutube(since, limit) {
      const rows = await db.execute<{
        rank: number;
        video_id: string;
        title: string;
        channel_title: string;
        thumbnail_url: string | null;
        view_count: string | number | null;
        published_at: Date | string | null;
        observed_at: Date | string;
      }>(sql`
        select rank, video_id, title, channel_title, thumbnail_url, view_count, published_at, observed_at
        from youtube_videos
        where observed_at = (
          select max(observed_at) from youtube_videos where observed_at >= ${since.toISOString()}
        )
        order by rank asc
        limit ${Math.min(Math.max(limit, 1), 50)}
      `);
      return rows.map((r) => ({
        rank: Number(r.rank),
        videoId: r.video_id,
        title: r.title,
        channelTitle: r.channel_title,
        thumbnailUrl: r.thumbnail_url,
        viewCount: r.view_count === null ? null : Number(r.view_count),
        publishedAt: r.published_at === null ? null : asDate(r.published_at),
        observedAt: asDate(r.observed_at),
      }));
    },

    async listStories(since, limit) {
      const stories = await db.execute<{
        id: number | string;
        title: string;
        publisher_count: number;
        first_item_at: Date | string;
        listed_at: Date | string;
        last_growth_at: Date | string | null;
        last_growth_by: number | null;
      }>(sql`
        select id, title, publisher_count, first_item_at, listed_at, last_growth_at, last_growth_by
        from news_stories
        where first_item_at >= ${since.toISOString()}
        order by publisher_count desc, coalesce(last_growth_at, listed_at) desc, id desc
        limit ${Math.min(Math.max(limit, 1), 50)}
      `);
      if (stories.length === 0) return [];
      const ids = stories.map((s) => Number(s.id));
      // Her sitenin bu habere ait ilk haberi (aynı site birden çok kez sayılmaz)
      const sources = await db.execute<{
        story_id: number | string;
        publisher_name: string;
        url: string;
        at: Date | string;
      }>(sql`
        select distinct on (nsi.story_id, si.publisher_id)
               nsi.story_id, p.name as publisher_name, si.url,
               coalesce(si.published_at, si.fetched_at) as at
        from news_story_items nsi
        join source_items si on si.id = nsi.source_item_id
        join publishers p on p.id = si.publisher_id
        where nsi.story_id in (${sql.join(
          ids.map((id) => sql`${id}`),
          sql`, `,
        )})
          and si.is_mock = false
        order by nsi.story_id, si.publisher_id, coalesce(si.published_at, si.fetched_at) asc
      `);
      const byStory = new Map<number, StoryRow["sources"]>();
      for (const r of sources) {
        const list = byStory.get(Number(r.story_id)) ?? [];
        list.push({ publisherName: r.publisher_name, url: r.url, publishedAt: asDate(r.at) });
        byStory.set(Number(r.story_id), list);
      }
      return stories.map((s) => ({
        id: Number(s.id),
        title: s.title,
        publisherCount: Number(s.publisher_count),
        firstItemAt: asDate(s.first_item_at),
        listedAt: asDate(s.listed_at),
        lastGrowthAt: s.last_growth_at === null ? null : asDate(s.last_growth_at),
        lastGrowthBy: s.last_growth_by === null ? null : Number(s.last_growth_by),
        sources: (byStory.get(Number(s.id)) ?? [])
          .sort((a, b) => a.publishedAt.getTime() - b.publishedAt.getTime())
          .slice(0, 50),
      }));
    },

    async getStory(id) {
      const [s] = await db.execute<{
        id: number | string;
        title: string;
        publisher_count: number;
        first_item_at: Date | string;
        listed_at: Date | string;
        last_growth_at: Date | string | null;
        last_growth_by: number | null;
      }>(sql`
        select id, title, publisher_count, first_item_at, listed_at, last_growth_at, last_growth_by
        from news_stories where id = ${id}
      `);
      if (!s) return null;
      const items = await db.execute<{
        publisher_name: string;
        title: string;
        url: string;
        published_at: Date | string;
        fetched_at: Date | string;
        added_at: Date | string;
      }>(sql`
        select p.name as publisher_name, si.title, si.url,
               coalesce(si.published_at, si.fetched_at) as published_at,
               si.fetched_at, nsi.added_at
        from news_story_items nsi
        join source_items si on si.id = nsi.source_item_id
        join publishers p on p.id = si.publisher_id
        where nsi.story_id = ${id} and si.is_mock = false
        order by coalesce(si.published_at, si.fetched_at) asc, si.id asc
        limit 200
      `);
      return {
        story: {
          id: Number(s.id),
          title: s.title,
          publisherCount: Number(s.publisher_count),
          firstItemAt: asDate(s.first_item_at),
          listedAt: asDate(s.listed_at),
          lastGrowthAt: s.last_growth_at === null ? null : asDate(s.last_growth_at),
          lastGrowthBy: s.last_growth_by === null ? null : Number(s.last_growth_by),
        },
        items: items.map((i) => ({
          publisherName: i.publisher_name,
          title: i.title,
          url: i.url,
          publishedAt: asDate(i.published_at),
          fetchedAt: asDate(i.fetched_at),
          addedAt: asDate(i.added_at),
        })),
      };
    },

    async ping() {
      await db.execute(sql`select 1`);
    },
  };
}
