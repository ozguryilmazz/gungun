// Veritabanı erişimi. Tüm sorgular Drizzle `sql` şablonuyla PARAMETRELİ gönderilir;
// kullanıcı girdisi hiçbir zaman SQL metnine eklenmez.
import { sql } from "drizzle-orm";
import type { Database } from "@gundemci/db";
import type { ScoreComponents } from "@gundemci/shared";

export interface SnapshotRef {
  capturedAt: Date;
  score: number | null;
}

export interface TopicRow {
  slug: string;
  title: string;
  categorySlug: string;
  categoryName: string;
  summary: string | null;
  isMock: boolean;
  topicUpdatedAt: Date;
  firstSeenAt: Date;
  latest: (SnapshotRef & { signalsAvailable: number; signalsTotal: number }) | null;
  previous: SnapshotRef | null;
  sourceCount: number;
}

export interface TopicDetailRow extends TopicRow {
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

export interface TopicRepository {
  listVisibleTopics(windowMinutes: number): Promise<TopicRow[]>;
  getTopicDetail(slug: string, windowMinutes: number): Promise<TopicDetailRow | null>;
  getTopicHistory(slug: string, since: Date): Promise<SnapshotRef[] | null>;
  listProviders(): Promise<ProviderRow[]>;
  ping(): Promise<void>;
}

const VISIBLE_STATUSES = sql`('published', 'cooling')`;
const MAX_TOPICS = 500;
const MAX_SOURCES = 50;

type RawTopic = {
  id: string;
  slug: string;
  title: string;
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
  prev_at: Date | null;
  prev_score: number | null;
  source_count: number;
  reasons?: string[];
  summary_origin?: "none" | "manual" | "ai";
};

const asDate = (v: Date | string) => (v instanceof Date ? v : new Date(v));

function mapTopic(r: RawTopic): TopicRow {
  return {
    slug: r.slug,
    title: r.title,
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
  };
}

/** Konu + en son snapshot + karşılaştırma snapshot'ı + kaynak sayısı */
function topicSelect(windowMinutes: number) {
  return sql`
    select t.id, t.slug, t.title, t.summary, t.is_mock, t.updated_at, t.first_seen_at,
           t.reasons, t.summary_origin,
           c.slug as category_slug, c.name as category_name,
           l.captured_at as latest_at, l.score as latest_score,
           l.signals_available, l.signals_total, l.components as latest_components,
           p.captured_at as prev_at, p.score as prev_score,
           (select count(*)::int from topic_items ti where ti.topic_id = t.id) as source_count
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
  `;
}

export function createTopicRepository(db: Database): TopicRepository {
  return {
    async listVisibleTopics(windowMinutes) {
      const rows = await db.execute<RawTopic>(sql`
        ${topicSelect(windowMinutes)}
        where t.status in ${VISIBLE_STATUSES}
        limit ${MAX_TOPICS}
      `);
      return rows.map(mapTopic);
    },

    async getTopicDetail(slug, windowMinutes) {
      const rows = await db.execute<RawTopic>(sql`
        ${topicSelect(windowMinutes)}
        where t.slug = ${slug} and t.status in ${VISIBLE_STATUSES}
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
          select si.title, si.url, p.name as publisher_name, si.published_at
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
        select id from topics where slug = ${slug} and status in ${VISIBLE_STATUSES} limit 1
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

    async ping() {
      await db.execute(sql`select 1`);
    },
  };
}
