import {
  CHANGE_WINDOW_HOURS,
  CHANGE_WINDOW_TOLERANCE_MINUTES,
  COMPONENT_KEYS,
  COMPONENT_LABELS,
  RISING_MIN_SOURCES,
  SafeUrlSchema,
  TIMELINE_LABELS,
  changePercent,
  classifyTrend,
  type ProviderStatus,
  type TopicDetail,
  type TopicSummary,
} from "@gundemci/shared";
import { TtlCache } from "../../lib/cache.ts";
import type {
  ProviderRow,
  SnapshotRef,
  TopicDetailRow,
  TopicRepository,
  TopicRow,
} from "./repository.ts";

/** "3 saat önceki" ölçüm en son ölçümden en az bu kadar dakika önce alınmış olmalı */
export const WINDOW_MINUTES = CHANGE_WINDOW_HOURS * 60 - CHANGE_WINDOW_TOLERANCE_MINUTES;

const HISTORY_HOURS = 24;
const TIMELINE_TYPES = new Set(Object.keys(TIMELINE_LABELS));

export interface RankedList {
  items: TopicSummary[];
  generatedAt: Date;
}

function toSummary(row: TopicRow, rank: number | null): TopicSummary {
  const score = row.latest?.score ?? null;
  const previousScore = row.previous?.score ?? null;
  const pct = changePercent(previousScore, score);
  return {
    slug: row.slug,
    title: row.title,
    kind: row.kind,
    headline:
      row.headline && SafeUrlSchema.safeParse(row.headline.url).success ? row.headline : null,
    category: { slug: row.categorySlug, name: row.categoryName },
    rank,
    score,
    previousScore,
    changePct: pct,
    trend: classifyTrend(pct),
    signalsAvailable: row.latest?.signalsAvailable ?? 0,
    signalsTotal: row.latest?.signalsTotal ?? COMPONENT_KEYS.length,
    sourceCount: row.sourceCount,
    summary: row.summary,
    updatedAt: (row.latest?.capturedAt ?? row.topicUpdatedAt).toISOString(),
    isMock: row.isMock,
  };
}

/** Skoru olan konular skora göre sıralanır ve sıra alır; skoru olmayanlar sonda, sırasız */
export function rankTopics(rows: TopicRow[]): TopicSummary[] {
  const scored = rows
    .filter((r) => r.latest?.score != null)
    .sort((a, b) => b.latest!.score! - a.latest!.score! || a.slug.localeCompare(b.slug));
  const unscored = rows
    .filter((r) => r.latest?.score == null)
    .sort((a, b) => a.slug.localeCompare(b.slug));
  return [...scored.map((r, i) => toSummary(r, i + 1)), ...unscored.map((r) => toSummary(r, null))];
}

export function selectRising(items: TopicSummary[], limit: number): TopicSummary[] {
  return (
    items
      .filter((t) => (t.trend === "surging" || t.trend === "rising") && t.changePct !== null)
      // Haber konularında az kaynaklı abartılı yüzdeler elenir; trend konularında arama hacmi yeterli sinyal
      .filter((t) => t.kind === "trend" || t.sourceCount >= RISING_MIN_SOURCES)
      .sort((a, b) => b.changePct! - a.changePct!)
      .slice(0, limit)
  );
}

export function selectFalling(items: TopicSummary[], limit: number): TopicSummary[] {
  return items
    .filter((t) => t.trend === "falling")
    .sort((a, b) => a.changePct! - b.changePct!)
    .slice(0, limit);
}

export function providerState(p: ProviderRow, now: Date): ProviderStatus["state"] {
  if (!p.isEnabled) return "not_connected";
  const lastSuccess = p.lastSuccessAt?.getTime() ?? 0;
  const lastError = p.lastErrorAt?.getTime() ?? 0;
  if (p.consecutiveFailures > 0 && lastError >= lastSuccess) return "error";
  const interval =
    typeof p.config.minIntervalMinutes === "number" ? p.config.minIntervalMinutes : 15;
  if (lastSuccess === 0 || now.getTime() - lastSuccess > interval * 3 * 60_000) return "stale";
  return "ok";
}

export class TopicService {
  private readonly listCache: TtlCache<RankedList>;

  private readonly detailCache: TtlCache<TopicDetail | null>;

  constructor(
    private readonly repo: TopicRepository,
    cacheTtlSeconds: number,
    private readonly clock: () => Date = () => new Date(),
  ) {
    this.listCache = new TtlCache(cacheTtlSeconds * 1000, 2);
    this.detailCache = new TtlCache(cacheTtlSeconds * 1000, 500);
  }

  /** Bir türdeki tüm görünür konular, kendi sıralamasıyla (önbellekli) */
  async ranked(kind: "trend" | "news" = "trend"): Promise<RankedList> {
    return this.listCache.getOrLoad(kind, async () => ({
      items: rankTopics(await this.repo.listVisibleTopics(WINDOW_MINUTES, kind)),
      generatedAt: this.clock(),
    }));
  }

  async getDetail(slug: string): Promise<TopicDetail | null> {
    return this.detailCache.getOrLoad(slug, async () => {
      const row = await this.repo.getTopicDetail(slug, WINDOW_MINUTES);
      if (!row) return null;
      // Sıra numarası global listeden gelir (tek kaynaktan tutarlı sıra)
      const { items } = await this.ranked(row.kind);
      const rank = items.find((t) => t.slug === slug)?.rank ?? null;
      return this.toDetail(row, rank);
    });
  }

  async getHistory(slug: string): Promise<SnapshotRef[] | null> {
    const since = new Date(this.clock().getTime() - HISTORY_HOURS * 3_600_000);
    return this.repo.getTopicHistory(slug, since);
  }

  async providerStatuses(): Promise<ProviderStatus[]> {
    const now = this.clock();
    const rows = await this.repo.listProviders();
    return rows
      .filter((p) => p.kind !== "manual") // seed/manuel kayıtlar veri kaynağı değildir
      .map((p) => ({
        key: p.key,
        kind: p.kind,
        name: p.name,
        state: providerState(p, now),
        lastSuccessAt: p.lastSuccessAt?.toISOString() ?? null,
      }));
  }

  private toDetail(row: TopicDetailRow, rank: number | null): TopicDetail {
    return {
      ...toSummary(row, row.isArchived ? null : rank),
      isArchived: row.isArchived,
      reasons: row.reasons.filter((r) => typeof r === "string").slice(0, 10),
      summaryOrigin: row.summaryOrigin,
      firstSeenAt: row.firstSeenAt.toISOString(),
      components: COMPONENT_KEYS.map((key) => {
        const c = row.components[key];
        const available = c?.available === true && typeof c.normalized === "number";
        return {
          key,
          label: COMPONENT_LABELS[key],
          available,
          value: available ? Math.round(c!.normalized! * 100) : null,
        };
      }),
      timeline: row.timeline
        .filter((e) => TIMELINE_TYPES.has(e.type))
        .map((e) => ({
          type: e.type as TopicDetail["timeline"][number]["type"],
          occurredAt: e.occurredAt.toISOString(),
        })),
      // Yalnızca http(s) bağlantılar; DB kısıtına ek savunma katmanı
      sources: row.sources
        .filter((s) => SafeUrlSchema.safeParse(s.url).success)
        .map((s) => ({
          title: s.title,
          url: s.url,
          publisherName: s.publisherName ?? "Bilinmeyen kaynak",
          publishedAt: s.publishedAt?.toISOString() ?? null,
        })),
    };
  }
}
