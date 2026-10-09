// Ortak haberler: aynı olayı en az 3 farklı haber sitesinin yayımladığı haberler (trend aramasından bağımsız).
//
//  - Her taramadan sonra son 24 saatin RSS haberleri benzer başlıklara göre gruplanır (cluster.ts).
//  - Bir grup ilk kez 3 farklı siteye ulaşınca listeye girer ("ortak haber" kaydı açılır).
//  - Sonraki taramalarda başka siteler de yayımlarsa site sayısı artar ve
//    "son güncellemeden sonra N haber sitesinde daha yayımlandı" notu için büyüme kaydedilir.
//  - Liste site sayısına göre sıralanır, en fazla 15 haber.
//
// Yapay zekâ yok; başlık, haberi yayımlayan sitelerden birinin başlığıdır (sakinleştirilmiş).
import { eq, inArray, sql } from "drizzle-orm";
import { newsStories, newsStoryItems, type Database } from "@gundemci/db";
import { clusterItems, distinctPublishers, representative, type ClusterInput } from "./cluster.ts";
import { calmTitle } from "./text.ts";

export const STORY_RULES = {
  /** Listeye girmek için en az farklı haber sitesi */
  minPublishers: 3,
  /** Haberin ilk yayınından bu kadar sonra listeden çıkar */
  windowHours: 24,
  /** Listede en fazla haber */
  maxListed: 15,
} as const;

export interface StoriesResult {
  created: number;
  grown: number;
}

/** Site sayısı arttıysa büyüme miktarı, artmadıysa null */
export function storyGrowth(previous: number, next: number): number | null {
  return next > previous ? next - previous : null;
}

/**
 * Ortak haberleri günceller. `items`: son 24 saatin RSS haberleri (topicId alanı kullanılmaz;
 * gruplama tohumu olarak haberin bağlı olduğu ortak haber kaydı kullanılır).
 */
export async function buildStories(
  db: Database,
  items: ClusterInput[],
  now: Date,
): Promise<StoriesResult> {
  const result: StoriesResult = { created: 0, grown: 0 };
  if (items.length === 0) return result;

  const seeds = await db
    .select({ sourceItemId: newsStoryItems.sourceItemId, storyId: newsStoryItems.storyId })
    .from(newsStoryItems)
    .where(
      inArray(
        newsStoryItems.sourceItemId,
        items.map((i) => i.id),
      ),
    );
  const storyOf = new Map(seeds.map((s) => [s.sourceItemId, s.storyId]));
  const clusters = clusterItems(
    items.map((i) => {
      const story = storyOf.get(i.id);
      return { ...i, topicId: story === undefined ? null : String(story) };
    }),
  );

  const storyIds = [...new Set(seeds.map((s) => s.storyId))];
  const existing = new Map(
    (storyIds.length
      ? await db
          .select({ id: newsStories.id, publisherCount: newsStories.publisherCount })
          .from(newsStories)
          .where(inArray(newsStories.id, storyIds))
      : []
    ).map((s) => [s.id, s.publisherCount]),
  );

  for (const cluster of clusters) {
    const fresh = cluster.items.filter((i) => i.topicId === null);
    if (cluster.topicId === null) {
      // Yeni grup: ancak en az 3 farklı sitede yayımlandıysa listeye girer
      const count = distinctPublishers(cluster.items);
      if (count < STORY_RULES.minPublishers) continue;
      const firstItemAt = cluster.items.reduce((min, i) => (i.at < min ? i.at : min), now);
      await db.transaction(async (tx) => {
        const [story] = await tx
          .insert(newsStories)
          .values({
            title: calmTitle(representative(cluster).title).slice(0, 300),
            publisherCount: count,
            firstItemAt,
            listedAt: now,
            updatedAt: now,
          })
          .returning({ id: newsStories.id });
        await tx
          .insert(newsStoryItems)
          .values(
            cluster.items.map((i) => ({ sourceItemId: i.id, storyId: story!.id, addedAt: now })),
          )
          .onConflictDoNothing();
      });
      result.created++;
      continue;
    }

    // Kayıtlı ortak habere yeni haberler katıldı: site sayısı arttıysa büyüme kaydedilir
    if (fresh.length === 0) continue;
    const storyId = Number(cluster.topicId);
    const previous = existing.get(storyId);
    if (previous === undefined) continue; // eşzamanlı silinmiş
    await db.transaction(async (tx) => {
      await tx
        .insert(newsStoryItems)
        .values(fresh.map((i) => ({ sourceItemId: i.id, storyId, addedAt: now })))
        .onConflictDoNothing();
      // Pencere dışına çıkmış eski haberler de sayılsın diye site sayısı tüm bağlı haberlerden hesaplanır
      const [row] = await tx.execute<{ n: number }>(sql`
        select count(distinct si.publisher_id)::int as n
        from news_story_items nsi
        join source_items si on si.id = nsi.source_item_id
        where nsi.story_id = ${storyId} and si.publisher_id is not null
      `);
      const count = Number(row?.n ?? 0);
      const growth = storyGrowth(previous, count);
      if (growth === null) return;
      await tx
        .update(newsStories)
        .set({ publisherCount: count, lastGrowthAt: now, lastGrowthBy: growth, updatedAt: now })
        .where(eq(newsStories.id, storyId));
      result.grown++;
    });
  }
  return result;
}
