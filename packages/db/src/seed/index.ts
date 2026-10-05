import { createHash } from "node:crypto";
import { eq, inArray, sql } from "drizzle-orm";
import type { Database } from "../client.js";
import {
  categories,
  dataProviders,
  publishers,
  sourceItems,
  timelineEvents,
  topicItems,
  topics,
  topicSnapshots,
} from "../schema.js";
import { MOCK_TOPICS, computeScore } from "@gundemci/shared";
import { MOCK_PROVIDER, MOCK_PUBLISHER } from "./mock-data.js";
import { CATEGORIES, DATA_PROVIDERS, PUBLISHERS } from "./reference-data.js";

export interface SeedOptions {
  /** true: örnek veriler yeniden oluşturulur. false: mevcut örnek veriler silinir. */
  includeMock: boolean;
  /** Test edilebilirlik için "şimdi" */
  now?: Date;
}

export interface SeedResult {
  categories: number;
  providers: number;
  publishers: number;
  mockTopics: number;
}

const minutesBefore = (now: Date, minutes: number) => new Date(now.getTime() - minutes * 60_000);

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

/**
 * Tekrar çalıştırılabilir (idempotent) seed.
 * - Referans verisi: kategoriler güncellenir; sağlayıcı/yayıncılar yalnızca yoksa eklenir
 *   (admin'in yaptığı değişikliklerin üzerine yazılmaz).
 * - Örnek veri: yalnızca is_mock=true satırlar silinip yeniden oluşturulur; gerçek veriye dokunulmaz.
 */
export async function seedDatabase(db: Database, options: SeedOptions): Promise<SeedResult> {
  const now = options.now ?? new Date();

  return db.transaction(async (tx) => {
    // ── Referans verisi ──
    await tx
      .insert(categories)
      .values([...CATEGORIES])
      .onConflictDoUpdate({
        target: categories.slug,
        set: { name: sql`excluded.name`, sortOrder: sql`excluded.sort_order` },
      });

    await tx
      .insert(dataProviders)
      .values(DATA_PROVIDERS.map((p) => ({ ...p, isEnabled: false })))
      .onConflictDoNothing({ target: dataProviders.key });

    await tx
      .insert(publishers)
      .values([...PUBLISHERS])
      .onConflictDoNothing({ target: publishers.domain });

    // ── Örnek veri: önce eskisini temizle (yalnızca is_mock=true) ──
    // topic silinince snapshot / topic_items / timeline_events CASCADE ile silinir
    await tx.delete(topics).where(eq(topics.isMock, true));
    await tx.delete(sourceItems).where(eq(sourceItems.isMock, true));

    if (!options.includeMock) {
      await tx.delete(publishers).where(eq(publishers.isMock, true));
      await tx.delete(dataProviders).where(eq(dataProviders.key, MOCK_PROVIDER.key));
      return {
        categories: CATEGORIES.length,
        providers: DATA_PROVIDERS.length,
        publishers: PUBLISHERS.length,
        mockTopics: 0,
      };
    }

    const [mockProvider] = await tx
      .insert(dataProviders)
      .values({ ...MOCK_PROVIDER, isEnabled: false, config: { mock: true } })
      .onConflictDoUpdate({ target: dataProviders.key, set: { name: MOCK_PROVIDER.name } })
      .returning({ id: dataProviders.id });

    const [mockPublisher] = await tx
      .insert(publishers)
      .values({ ...MOCK_PUBLISHER, feedUrl: null, isActive: false, isMock: true })
      .onConflictDoUpdate({
        target: publishers.domain,
        set: { name: MOCK_PUBLISHER.name, isActive: false, isMock: true, feedUrl: null },
      })
      .returning({ id: publishers.id });

    if (!mockProvider || !mockPublisher) {
      throw new Error("Örnek sağlayıcı/yayıncı oluşturulamadı");
    }

    const categoryRows = await tx
      .select({ id: categories.id, slug: categories.slug })
      .from(categories)
      .where(
        inArray(
          categories.slug,
          MOCK_TOPICS.map((t) => t.categorySlug),
        ),
      );
    const categoryIdBySlug = new Map(categoryRows.map((c) => [c.slug, c.id]));

    // Sıralama: eski ve yeni snapshot'lar için ayrı ayrı skora göre
    const scored = MOCK_TOPICS.map((topic) => ({
      topic,
      previous: computeScore(topic.snapshots[0].normalized),
      latest: computeScore(topic.snapshots[1].normalized),
    }));
    const rankOf = (pick: "previous" | "latest") => {
      const ordered = [...scored].sort((a, b) => (b[pick].score ?? -1) - (a[pick].score ?? -1));
      return new Map(ordered.map((entry, index) => [entry.topic.slug, index + 1]));
    };
    const previousRank = rankOf("previous");
    const latestRank = rankOf("latest");

    for (const { topic, previous, latest } of scored) {
      const categoryId = categoryIdBySlug.get(topic.categorySlug);
      if (categoryId === undefined) {
        throw new Error(`Bilinmeyen kategori: ${topic.categorySlug}`);
      }

      const firstSeenAt = minutesBefore(now, topic.firstSeenMinutesAgo);
      const [inserted] = await tx
        .insert(topics)
        .values({
          slug: topic.slug,
          title: topic.title,
          categoryId,
          summary: topic.summary,
          reasons: topic.reasons,
          status: topic.status,
          summaryOrigin: "manual",
          isMock: true,
          firstSeenAt,
          publishedAt: minutesBefore(now, topic.firstSeenMinutesAgo - 30),
        })
        .returning({ id: topics.id });
      if (!inserted) throw new Error(`Konu eklenemedi: ${topic.slug}`);

      await tx.insert(topicSnapshots).values([
        {
          topicId: inserted.id,
          capturedAt: minutesBefore(now, topic.snapshots[0].minutesAgo),
          ...previous,
          rank: previousRank.get(topic.slug) ?? null,
          isMock: true,
        },
        {
          topicId: inserted.id,
          capturedAt: minutesBefore(now, topic.snapshots[1].minutesAgo),
          ...latest,
          rank: latestRank.get(topic.slug) ?? null,
          isMock: true,
        },
      ]);

      const items = Array.from({ length: topic.sourceCount }, (_, i) => {
        const url = `https://example.org/ornek/${topic.slug}/${i + 1}`;
        return {
          providerId: mockProvider.id,
          publisherId: mockPublisher.id,
          url,
          urlHash: sha256(url),
          title: `Örnek kaynak başlığı ${i + 1} — ${topic.title.replace(/^Örnek: /, "")}`,
          publishedAt: minutesBefore(now, topic.firstSeenMinutesAgo - i * 25),
          fetchedAt: now,
          isMock: true,
        };
      });
      const insertedItems = await tx
        .insert(sourceItems)
        .values(items)
        .returning({ id: sourceItems.id, publishedAt: sourceItems.publishedAt });

      await tx
        .insert(topicItems)
        .values(insertedItems.map((item) => ({ topicId: inserted.id, sourceItemId: item.id })));

      if (topic.withTimeline) {
        const [first, second] = insertedItems;
        await tx.insert(timelineEvents).values([
          {
            topicId: inserted.id,
            occurredAt: first?.publishedAt ?? firstSeenAt,
            type: "first_source",
            sourceItemId: first?.id ?? null,
            isMock: true,
          },
          {
            topicId: inserted.id,
            occurredAt: second?.publishedAt ?? firstSeenAt,
            type: "news_spread",
            sourceItemId: second?.id ?? null,
            isMock: true,
          },
          {
            topicId: inserted.id,
            occurredAt: minutesBefore(now, 60),
            type: "search_spike",
            sourceItemId: null,
            isMock: true,
          },
          {
            topicId: inserted.id,
            occurredAt: minutesBefore(now, 20),
            type: "entered_top5",
            sourceItemId: null,
            isMock: true,
          },
        ]);
      }
    }

    return {
      categories: CATEGORIES.length,
      providers: DATA_PROVIDERS.length,
      publishers: PUBLISHERS.length,
      mockTopics: MOCK_TOPICS.length,
    };
  });
}
