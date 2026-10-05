// Arama öncelikli gündem üretimi: Trends → trend konuları (+ açıklayıcı haberler), eşleşmeyen büyük
// haberler → haber konuları, yaşam döngüsü, API ve arşiv. Gerçek PostgreSQL.
// Yalnızca TEST_DATABASE_URL tanımlıysa çalışır ve veritabanını SIFIRLAR (adı "_test" ile bitmeli).
import { createHash } from "node:crypto";
import {
  createDb,
  dataProviders,
  publishers,
  runMigrations,
  seedDatabase,
  sourceItems,
  timelineEvents,
  topicItems,
  topics,
  topicSnapshots,
  trendSignals,
  type Database,
} from "@gundemci/db";
import {
  ArchiveDayResponseSchema,
  TopicDetailResponseSchema,
  TopicListResponseSchema,
} from "@gundemci/shared";
import { and, asc, eq, sql } from "drizzle-orm";
import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.ts";
import { createTopicRepository } from "../src/modules/topics/repository.ts";
import { buildTopics, displayTerm } from "../src/topics-pipeline/pipeline.ts";

const URL_ = process.env.TEST_DATABASE_URL;
const silent = { info() {}, warn() {}, error() {} };
// İstanbul'da 5 Ekim 2026 öğlen 12:00 (UTC 09:00)
const T0 = new Date("2026-10-05T09:00:00Z");
const at = (minutesFromT0: number) => new Date(T0.getTime() + minutesFromT0 * 60_000);

describe.skipIf(!URL_)("arama öncelikli gündem üretimi", () => {
  let db: Database;
  let client: postgres.Sql;
  let close: () => Promise<void>;
  let pubs: { id: number; domain: string }[];
  let rssProviderId: number;
  let trendsProviderId: number;
  const build = (now: Date) => buildTopics({ db, client, log: silent, now: () => now });
  const real = async (kind?: "trend" | "news") =>
    db
      .select()
      .from(topics)
      .where(
        kind ? and(eq(topics.isMock, false), eq(topics.kind, kind)) : eq(topics.isMock, false),
      );

  async function addItem(pubIndex: number, title: string, minutes: number, section = "ekonomi") {
    const p = pubs[pubIndex]!;
    const url = `https://www.${p.domain}/${section}/${createHash("md5")
      .update(title + pubIndex)
      .digest("hex")
      .slice(0, 8)}`;
    await db.insert(sourceItems).values({
      providerId: rssProviderId,
      publisherId: p.id,
      url,
      urlHash: createHash("sha256").update(url).digest("hex"),
      title,
      publishedAt: at(minutes),
      fetchedAt: at(minutes),
    });
  }

  async function trendBatch(
    minutes: number,
    terms: {
      term: string;
      traffic: number;
      related?: { title: string; url: string; source: string }[];
    }[],
  ) {
    await db
      .update(dataProviders)
      .set({ lastSuccessAt: at(minutes) })
      .where(eq(dataProviders.id, trendsProviderId));
    await db.insert(trendSignals).values(
      terms.map((t) => ({
        providerId: trendsProviderId,
        term: t.term,
        geo: "TR",
        approxTraffic: t.traffic,
        observedAt: at(minutes),
        related: t.related ?? [],
      })),
    );
  }

  beforeAll(async () => {
    const url = URL_ as string;
    if (!new URL(url).pathname.endsWith("_test"))
      throw new Error("veritabanı adı '_test' ile bitmeli");
    ({ db, client, close } = createDb(url, { max: 5 }));
    await db.execute(sql`drop schema if exists drizzle cascade`);
    await db.execute(sql`drop schema public cascade`);
    await db.execute(sql`create schema public`);
    await runMigrations(url);
    await seedDatabase(db, { includeMock: false, now: T0 });
    pubs = await db
      .select({ id: publishers.id, domain: publishers.domain })
      .from(publishers)
      .where(eq(publishers.isMock, false))
      .orderBy(asc(publishers.id));
    const providers = await db
      .select({ id: dataProviders.id, key: dataProviders.key })
      .from(dataProviders);
    rssProviderId = providers.find((p) => p.key === "rss_news")!.id;
    trendsProviderId = providers.find((p) => p.key === "google_trends")!.id;

    // Haberler
    await addItem(0, "Merkez Bankası politika faizini yüzde 40'ta sabit tuttu", -100);
    await addItem(1, "Merkez Bankası faiz kararını açıkladı: politika faizi sabit", -90);
    await addItem(2, "Merkez Bankası politika faizini sabit bıraktı", -40);
    await addItem(3, "Merkez Bankası faiz kararı: politika faizi yüzde 40", -20);
    await addItem(4, "Fenerbahçe derbide Galatasaray'ı 2-1 yendi", -60, "spor");
    await addItem(5, "Derbide kazanan Fenerbahçe: Galatasaray 1-2 Fenerbahçe", -50, "spor");
    await addItem(6, "İstanbul'da kar yağışı ulaşımı aksattı", -30, "gundem");

    // Trend listesi (5 dk önce çekilmiş)
    await trendBatch(-5, [
      {
        term: "derbi",
        traffic: 50000,
        related: [
          {
            title: "Derbinin ardından açıklamalar",
            url: "https://www.sporsitesi.example/derbi",
            source: "Spor Sitesi",
          },
        ],
      },
      { term: "merkez bankası", traffic: 20000 },
      { term: "uzay", traffic: 5000 },
      { term: "sözcü", traffic: 10000 }, // medya adı → konu olmaz
    ]);
  });

  afterAll(async () => {
    await close?.();
  });

  it("her trend araması bir konu olur; haberler konuyu açıklar; medya adı atlanır", async () => {
    const r = await build(T0);
    expect(r.trends).toBe(3);
    const trendTopics = await real("trend");
    expect(trendTopics.map((t) => t.title).sort()).toEqual(["Derbi", "Merkez Bankası", "Uzay"]);
    expect(trendTopics.every((t) => t.status === "published")).toBe(true);
    // Aramayla eşleşen kümeler ayrı haber konusu açmaz
    expect(await real("news")).toHaveLength(0);

    const derbi = trendTopics.find((t) => t.title === "Derbi")!;
    expect(derbi.reasons[0]).toBe("Google’da Türkiye trend listesinde (yaklaşık 50.000+ arama)");
    const links = await db
      .select({ source: sourceItems.sourceName, publisherId: sourceItems.publisherId })
      .from(topicItems)
      .innerJoin(sourceItems, eq(sourceItems.id, topicItems.sourceItemId))
      .where(eq(topicItems.topicId, derbi.id));
    expect(links).toHaveLength(3); // 2 haber + Google'ın ilgili haberi
    expect(links.some((l) => l.source === "Spor Sitesi" && l.publisherId === null)).toBe(true);

    const events = (
      await db.select().from(timelineEvents).where(eq(timelineEvents.topicId, derbi.id))
    ).map((e) => e.type);
    expect(events).toEqual(expect.arrayContaining(["trend_listed", "entered_top5"]));

    // Haberi olmayan arama da konu olur (yalnızca arama sinyaliyle)
    const uzay = trendTopics.find((t) => t.title === "Uzay")!;
    expect(await db.select().from(topicItems).where(eq(topicItems.topicId, uzay.id))).toHaveLength(
      0,
    );

    const [snap] = await db
      .select()
      .from(topicSnapshots)
      .where(eq(topicSnapshots.topicId, derbi.id));
    expect(snap?.components.search_interest?.available).toBe(true);
    expect(snap?.components.social?.available).toBe(false);
  });

  it("eskiden bağlanmış alakasız ilgili haber konudan çıkarılır; açıklaması olmayan arama sonra sıralanır", async () => {
    const uzay = (await real("trend")).find((t) => t.title === "Uzay")!;
    const url = "https://www.baskasite.example/alakasiz";
    const [stale] = await db
      .insert(sourceItems)
      .values({
        providerId: trendsProviderId,
        publisherId: null,
        sourceName: "Başka Site",
        url,
        urlHash: createHash("sha256").update(url).digest("hex"),
        title: "Bambaşka bir konu hakkında haber",
        fetchedAt: at(-5),
      })
      .returning({ id: sourceItems.id });
    await db.insert(topicItems).values({ topicId: uzay.id, sourceItemId: stale!.id });
    await build(at(1));
    expect(await db.select().from(topicItems).where(eq(topicItems.topicId, uzay.id))).toHaveLength(
      0,
    );

    const app = await buildApp({
      repo: createTopicRepository(db),
      cacheTtlSeconds: 0,
      rateLimitMax: 1000,
      logLevel: "silent",
    });
    const list = TopicListResponseSchema.parse((await app.inject("/api/v1/topics")).json());
    expect(list.items.at(-1)?.title).toBe("Uzay");
    expect(list.items.at(-1)?.sourceCount).toBe(0);
    await app.close();
  });

  it("aramada olmayan ama çok kaynaklı olay 'haber' konusu olur", async () => {
    for (const [i, title] of [
      "Ankara'da fabrikada büyük yangın çıktı",
      "Ankara'daki fabrika yangınına çok sayıda ekip sevk edildi",
      "Ankara fabrika yangını kontrol altına alındı",
      "Ankara'da fabrika yangını: dumanlar kilometrelerce uzaktan görüldü",
    ].entries()) {
      await addItem(7 + i, title, 5 + i, "gundem");
    }
    await build(at(15));
    const news = await real("news");
    expect(news).toHaveLength(1);
    expect(news[0]?.status).toBe("published");
    expect(news[0]?.reasons).toContain("Google’ın Türkiye trend listesinde değil");
  });

  it("API: varsayılan liste trendler, haberler ayrı; kartta kaynaklı başlık", async () => {
    const app = await buildApp({
      repo: createTopicRepository(db),
      cacheTtlSeconds: 0,
      rateLimitMax: 1000,
      logLevel: "silent",
    });
    const trends = TopicListResponseSchema.parse((await app.inject("/api/v1/topics")).json());
    expect(trends.items.every((t) => t.kind === "trend")).toBe(true);
    expect(trends.items[0]?.title).toBe("Derbi"); // en yüksek arama hacmi
    expect(trends.items[0]?.headline?.source).toBe("Spor Sitesi");
    const news = TopicListResponseSchema.parse(
      (await app.inject("/api/v1/topics?kind=news")).json(),
    );
    expect(news.items.map((t) => t.kind)).toEqual(["news"]);

    const detail = TopicDetailResponseSchema.parse(
      (await app.inject(`/api/v1/topics/${trends.items[0]!.slug}`)).json(),
    );
    expect(detail.item.sources.map((s) => s.publisherName)).toContain("Spor Sitesi");
    await app.close();
  });

  it("listeden çıkan arama soğur, sonra arşive düşer; arşivden açılır", async () => {
    await trendBatch(60, [{ term: "derbi", traffic: 100000 }]);
    const r = await build(at(65));
    expect(r.cooling).toBeGreaterThanOrEqual(2);
    const merkez = (await real("trend")).find((t) => t.title === "Merkez Bankası")!;
    expect(merkez.status).toBe("cooling");
    expect(merkez.reasons[0]).toBe("Google’ın Türkiye trend listesinden çıktı");
    const left = await db
      .select()
      .from(timelineEvents)
      .where(and(eq(timelineEvents.topicId, merkez.id), eq(timelineEvents.type, "trend_left")));
    expect(left).toHaveLength(1);

    // 5 saat sonra Trends verisi de eskidi: tüm trend konuları arşivde
    await build(at(60 * 5));
    expect((await real("trend")).every((t) => t.status === "archived")).toBe(true);

    const app = await buildApp({
      repo: createTopicRepository(db),
      cacheTtlSeconds: 0,
      rateLimitMax: 1000,
      logLevel: "silent",
    });
    const day = ArchiveDayResponseSchema.parse(
      (await app.inject("/api/v1/archive/2026-10-05")).json(),
    );
    expect(day.items.map((i) => i.title)).toEqual(
      expect.arrayContaining(["Derbi", "Merkez Bankası", "Uzay"]),
    );
    const detail = TopicDetailResponseSchema.parse(
      (await app.inject(`/api/v1/topics/${merkez.slug}`)).json(),
    );
    expect(detail.item.isArchived).toBe(true);
    await app.close();
  });

  it("displayTerm Türkçe büyük harf kuralına uyar", () => {
    expect(displayTerm("ali koç")).toBe("Ali Koç");
    expect(displayTerm("istanbul")).toBe("İstanbul");
    expect(displayTerm("iPhone 18")).toBe("iPhone 18");
  });
});
