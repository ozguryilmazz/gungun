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

/** Ortak habere bağlı tek bir haber (detay sayfası için) */
export interface StoryItem {
  publisherName: string;
  title: string;
  url: string;
  /** Sitenin bildirdiği yayın zamanı (yoksa bizim çektiğimiz an) */
  publishedAt: Date;
  /** Haberi RSS'te ilk gördüğümüz an */
  fetchedAt: Date;
  /** Haberin ortak habere bağlandığı tarama */
  addedAt: Date;
}

export interface StorySite {
  name: string;
  title: string;
  url: string;
  publishedAt: Date;
  fetchedAt: Date;
  addedAt: Date;
}

export interface StorySpread {
  /** Sitelere ilk yayın zamanına göre (her site bir kez) */
  sites: StorySite[];
  /** Taramalar: hangi taramada hangi siteler eklendi (ilk kayıt = listeye girdiği tarama) */
  scans: { at: Date; sites: string[] }[];
  /** İlk yayından 3. sitenin yayınına kadar geçen dakika */
  minutesToThreeSites: number | null;
  /** İlk yayından sonraki 1 saatte yayımlayan site sayısı (ilk site dahil) */
  sitesInFirstHour: number;
  /** Son 1 saatte yayımlayan yeni site sayısı */
  sitesInLastHour: number;
  /** İlk ve son sitenin yayını arasındaki dakika */
  spanMinutes: number;
}

const minutesBetween = (a: Date, b: Date) => Math.round((b.getTime() - a.getTime()) / 60_000);

/** Bir ortak haberin yayılması: ölçülen veriden (uydurma yok) */
export function describeSpread(items: StoryItem[], now: Date): StorySpread {
  const sorted = [...items].sort(
    (a, b) => a.publishedAt.getTime() - b.publishedAt.getTime() || a.url.localeCompare(b.url),
  );
  const sites: StorySite[] = [];
  const seen = new Set<string>();
  for (const i of sorted) {
    if (seen.has(i.publisherName)) continue;
    seen.add(i.publisherName);
    sites.push({
      name: i.publisherName,
      title: i.title,
      url: i.url,
      publishedAt: i.publishedAt,
      fetchedAt: i.fetchedAt,
      addedAt: i.addedAt,
    });
  }

  // Her site, kendi ilk haberinin bağlandığı taramada sayılır
  const byScan = new Map<number, string[]>();
  for (const s of sites) {
    const firstAdded = items
      .filter((i) => i.publisherName === s.name)
      .reduce((min, i) => (i.addedAt < min ? i.addedAt : min), s.addedAt);
    const key = firstAdded.getTime();
    byScan.set(key, [...(byScan.get(key) ?? []), s.name]);
  }
  const scans = [...byScan.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([at, names]) => ({ at: new Date(at), sites: names }));

  const first = sites[0];
  const last = sites[sites.length - 1];
  return {
    sites,
    scans,
    minutesToThreeSites:
      first && sites[2] ? minutesBetween(first.publishedAt, sites[2].publishedAt) : null,
    sitesInFirstHour: first
      ? sites.filter((s) => s.publishedAt.getTime() - first.publishedAt.getTime() <= 3_600_000)
          .length
      : 0,
    sitesInLastHour: sites.filter((s) => now.getTime() - s.publishedAt.getTime() <= 3_600_000)
      .length,
    spanMinutes: first && last ? minutesBetween(first.publishedAt, last.publishedAt) : 0,
  };
}
