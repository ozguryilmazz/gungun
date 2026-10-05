import type {
  ProviderRow,
  TopicDetailRow,
  TopicRepository,
  TopicRow,
} from "../src/modules/topics/repository.ts";

export const NOW = new Date("2026-10-05T12:00:00Z");
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000);

export function topicRow(overrides: Partial<TopicRow> & { slug: string }): TopicRow {
  return {
    title: `Örnek: ${overrides.slug}`,
    categorySlug: "teknoloji",
    categoryName: "Teknoloji",
    summary: "Bu bir örnek konudur.",
    isMock: true,
    topicUpdatedAt: minutesAgo(5),
    firstSeenAt: minutesAgo(300),
    latest: { capturedAt: minutesAgo(5), score: 50, signalsAvailable: 3, signalsTotal: 4 },
    previous: { capturedAt: minutesAgo(185), score: 50 },
    sourceCount: 3,
    ...overrides,
  };
}

export const ROWS: TopicRow[] = [
  topicRow({
    slug: "ornek-yukselen",
    latest: { capturedAt: minutesAgo(4), score: 92, signalsAvailable: 3, signalsTotal: 4 },
    previous: { capturedAt: minutesAgo(184), score: 55 },
    sourceCount: 4,
  }),
  topicRow({
    slug: "ornek-az-kaynakli",
    categorySlug: "bilim",
    categoryName: "Bilim",
    latest: { capturedAt: minutesAgo(10), score: 70, signalsAvailable: 2, signalsTotal: 4 },
    previous: { capturedAt: minutesAgo(190), score: 32 },
    sourceCount: 2,
  }),
  topicRow({
    slug: "ornek-dusen",
    categorySlug: "viral",
    categoryName: "Viral",
    latest: { capturedAt: minutesAgo(9), score: 33, signalsAvailable: 3, signalsTotal: 4 },
    previous: { capturedAt: minutesAgo(189), score: 69 },
  }),
  topicRow({ slug: "ornek-skorsuz", latest: null, previous: null, sourceCount: 0 }),
];

export const PROVIDERS: ProviderRow[] = [
  {
    key: "google_trends",
    kind: "trend",
    name: "Google Trends",
    isEnabled: false,
    config: {},
    lastSuccessAt: null,
    lastErrorAt: null,
    consecutiveFailures: 0,
  },
  {
    key: "rss_news",
    kind: "news",
    name: "Haber RSS",
    isEnabled: true,
    config: { minIntervalMinutes: 10 },
    lastSuccessAt: minutesAgo(5),
    lastErrorAt: null,
    consecutiveFailures: 0,
  },
  {
    key: "seed",
    kind: "manual",
    name: "Örnek veri (seed)",
    isEnabled: false,
    config: {},
    lastSuccessAt: null,
    lastErrorAt: null,
    consecutiveFailures: 0,
  },
];

export interface FakeRepo extends TopicRepository {
  calls: Record<string, number>;
  failWith?: Error;
  pingFails?: boolean;
}

export function fakeRepo(rows: TopicRow[] = ROWS): FakeRepo {
  const calls: Record<string, number> = {};
  const count = (k: string) => (calls[k] = (calls[k] ?? 0) + 1);
  const repo: FakeRepo = {
    calls,
    async listVisibleTopics() {
      count("list");
      if (repo.failWith) throw repo.failWith;
      return rows;
    },
    async getTopicDetail(slug) {
      count("detail");
      if (repo.failWith) throw repo.failWith;
      const row = rows.find((r) => r.slug === slug);
      if (!row) return null;
      const detail: TopicDetailRow = {
        ...row,
        reasons: ["Örnek: neden"],
        summaryOrigin: "manual",
        components: {
          news_visibility: { available: true, normalized: 0.9, raw: null },
          velocity: { available: true, normalized: 0.95, raw: null },
          search_interest: { available: false, normalized: null, raw: null },
          social: { available: false, normalized: null, raw: null },
        },
        timeline: [
          { type: "first_source", occurredAt: minutesAgo(300) },
          { type: "bilinmeyen_tur", occurredAt: minutesAgo(200) },
        ],
        sources: [
          {
            title: "Kaynak 1",
            url: "https://example.org/1",
            publisherName: "Örnek Kaynak",
            publishedAt: minutesAgo(300),
          },
          { title: "Zararlı", url: "javascript:alert(1)", publisherName: null, publishedAt: null },
        ],
      };
      return detail;
    },
    async getTopicHistory(slug) {
      count("history");
      const row = rows.find((r) => r.slug === slug);
      if (!row) return null;
      return [row.previous, row.latest]
        .filter((s) => s !== null)
        .map((s) => ({ capturedAt: s!.capturedAt, score: s!.score }));
    },
    async listProviders() {
      return PROVIDERS;
    },
    async ping() {
      if (repo.pingFails) throw new Error("connect ECONNREFUSED 10.0.0.5:5432 password=gizli");
    },
  };
  return repo;
}
