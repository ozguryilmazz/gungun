// ⚠ ÖRNEK VERİ KAYNAĞI — API bağlanana kadar (aşama 6) kullanılır.
// Veritabanı seed'iyle aynı örnek konulardan, API sözleşmesine uygun yanıtlar üretir.
// Ürettiği her yanıt meta.isMock = true taşır; arayüz bunu görünce "ÖRNEK VERİ" şeridini gösterir.
import {
  COMPONENT_KEYS,
  COMPONENT_LABELS,
  MOCK_TOPICS,
  changePercent,
  classifyTrend,
  computeScore,
  findCategory,
  type MockTopic,
  type TopicDetail,
} from "@gundemci/shared";

const MOCK_PUBLISHER_NAME = "Örnek Kaynak (mock)";

const minutesBefore = (now: Date, minutes: number) =>
  new Date(now.getTime() - minutes * 60_000).toISOString();

function buildTopic(topic: MockTopic, now: Date): Omit<TopicDetail, "rank"> {
  const category = findCategory(topic.categorySlug);
  if (!category) throw new Error(`Bilinmeyen kategori: ${topic.categorySlug}`);

  const previous = computeScore(topic.snapshots[0].normalized);
  const latest = computeScore(topic.snapshots[1].normalized);
  const pct = changePercent(previous.score, latest.score);

  const sources = Array.from({ length: topic.sourceCount }, (_, i) => ({
    title: `Örnek kaynak başlığı ${i + 1} — ${topic.title.replace(/^Örnek: /, "")}`,
    url: `https://example.org/ornek/${topic.slug}/${i + 1}`,
    publisherName: MOCK_PUBLISHER_NAME,
    publishedAt: minutesBefore(now, topic.firstSeenMinutesAgo - i * 25),
  }));

  const timeline: TopicDetail["timeline"] = topic.withTimeline
    ? [
        { type: "first_source", occurredAt: sources[0]?.publishedAt ?? minutesBefore(now, 300) },
        { type: "news_spread", occurredAt: sources[1]?.publishedAt ?? minutesBefore(now, 270) },
        { type: "search_spike", occurredAt: minutesBefore(now, 60) },
        { type: "entered_top5", occurredAt: minutesBefore(now, 20) },
      ]
    : [];

  return {
    slug: topic.slug,
    title: topic.title,
    category: { slug: category.slug, name: category.name },
    score: latest.score,
    previousScore: previous.score,
    changePct: pct,
    trend: classifyTrend(pct),
    signalsAvailable: latest.signalsAvailable,
    signalsTotal: latest.signalsTotal,
    sourceCount: sources.length,
    summary: topic.summary,
    updatedAt: minutesBefore(now, topic.snapshots[1].minutesAgo),
    isMock: true,
    reasons: topic.reasons,
    summaryOrigin: "manual",
    firstSeenAt: minutesBefore(now, topic.firstSeenMinutesAgo),
    components: COMPONENT_KEYS.map((key) => {
      const c = latest.components[key];
      return {
        key,
        label: COMPONENT_LABELS[key],
        available: c?.available ?? false,
        value: c?.normalized == null ? null : Math.round(c.normalized * 100),
      };
    }),
    timeline,
    sources,
  };
}

/** Tüm örnek konular, güncel skora göre sıralı ve sıra numaralı */
export function buildMockTopics(now: Date): TopicDetail[] {
  return MOCK_TOPICS.map((t) => buildTopic(t, now))
    .sort((a, b) => (b.score ?? -1) - (a.score ?? -1))
    .map((t, i) => ({ ...t, rank: i + 1 }));
}
