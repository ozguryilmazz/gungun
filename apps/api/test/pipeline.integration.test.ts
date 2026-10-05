// Gündem üretim süreci: haber → konu → skor → yaşam döngüsü → API/arşiv. Gerçek PostgreSQL.
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
import { asc, eq, sql } from "drizzle-orm";
import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.ts";
import { createTopicRepository } from "../src/modules/topics/repository.ts";
import { buildTopics } from "../src/topics-pipeline/pipeline.ts";

const URL_ = process.env.TEST_DATABASE_URL;
const silent = { info() {}, warn() {}, error() {} };
// İstanbul'da 5 Ekim 2026 öğlen 12:00 (UTC 09:00)
const T0 = new Date("2026-10-05T09:00:00Z");
const at = (minutesFromT0: number) => new Date(T0.getTime() + minutesFromT0 * 60_000);

describe.skipIf(!URL_)("gündem üretim süreci", () => {
  let db: Database;
  let client: postgres.Sql;
  let close: () => Promise<void>;
  let pubs: { id: number; domain: string }[];
  let rssProviderId: number;
  const build = (now: Date) => buildTopics({ db, client, log: silent, now: () => now });

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

  beforeAll(async () => {
    const url = URL_ as string;
    if (!new URL(url).pathname.endsWith("_test"))
      throw new Error("veritabanı adı '_test' ile bitmeli");
    ({ db, client, close } = createDb(url, { max: 5 }));
    await db.execute(sql`drop schema if exists drizzle cascade`);
    await db.execute(sql`drop schema public cascade`);
    await db.execute(sql`create schema public`);
    await runMigrations(url);
    await seedDatabase(db, { includeMock: true, now: T0 });
    pubs = await db
      .select({ id: publishers.id, domain: publishers.domain })
      .from(publishers)
      .where(eq(publishers.isMock, false))
      .orderBy(asc(publishers.id));
    const [p] = await db
      .select({ id: dataProviders.id })
      .from(dataProviders)
      .where(eq(dataProviders.key, "rss_news"));
    rssProviderId = p!.id;

    // Olay A: 4 yayıncı (yayına girmeli)
    await addItem(0, "Merkez Bankası politika faizini yüzde 40'ta sabit tuttu", -100);
    await addItem(
      1,
      "SON DAKİKA: Merkez Bankası faiz kararını açıkladı: politika faizi sabit",
      -90,
    );
    await addItem(2, "Merkez Bankası politika faizini sabit bıraktı", -40);
    await addItem(3, "Merkez Bankası faiz kararı: politika faizi yüzde 40", -20);
    // Olay B: 2 yayıncı (aday kalmalı; Trends eşleşirse yayına girmeli)
    await addItem(4, "Fenerbahçe derbide Galatasaray'ı 2-1 yendi", -60, "spor");
    await addItem(5, "Derbide kazanan Fenerbahçe: Galatasaray 1-2 Fenerbahçe", -50, "spor");
    // Tek yayıncı: konu olmamalı
    await addItem(6, "İstanbul'da kar yağışı ulaşımı aksattı", -30, "gundem");
    // 24 saatten eski: hiç dikkate alınmamalı
    await addItem(7, "Merkez Bankası politika faizi eski haber", -60 * 30);
  });

  afterAll(async () => {
    await close?.();
  });

  it("konular oluşur; yalnızca yeterli kaynaklı olan yayına girer", async () => {
    const r = await build(T0);
    expect(r.itemsInWindow).toBe(7);
    expect(r.created).toBe(2);
    expect(r.published).toBe(1);

    const real = await db.select().from(topics).where(eq(topics.isMock, false));
    const faiz = real.find((t) => t.title.includes("Merkez Bankası"))!;
    const derbi = real.find((t) => t.title.includes("Fenerbahçe"))!;
    expect(faiz.status).toBe("published");
    expect(derbi.status).toBe("candidate");
    // Başlık kaynaklardan seçilir ve bağıran önek temizlenir
    expect(faiz.title).not.toMatch(/SON DAKİKA/i);
    expect(faiz.slug).toMatch(/^[a-z0-9-]+$/);
    // Kategori adreslerden çıkarılır
    const cats = await db.execute<{ slug: string }>(
      sql`select c.slug from categories c where c.id = ${faiz.categoryId}`,
    );
    expect(cats[0]?.slug).toBe("ekonomi");
    // Özet uydurulmaz; maddeler yalnızca ölçülen veriden
    expect(faiz.summary).toBeNull();
    expect(faiz.summaryOrigin).toBe("none");
    expect(faiz.reasons).toContain("4 farklı haber kaynağında yer aldı");

    const links = await db.select().from(topicItems).where(eq(topicItems.topicId, faiz.id));
    expect(links).toHaveLength(4);
    const events = (
      await db.select().from(timelineEvents).where(eq(timelineEvents.topicId, faiz.id))
    ).map((e) => e.type);
    expect(events).toEqual(expect.arrayContaining(["first_source", "news_spread", "entered_top5"]));
  });

  it("Trends verisi yokken arama ilgisi 'veri bekleniyor'; eşleşince konu yayına girer", async () => {
    const [faizSnap] = await db
      .select({ components: topicSnapshots.components, signals: topicSnapshots.signalsAvailable })
      .from(topicSnapshots)
      .innerJoin(topics, eq(topics.id, topicSnapshots.topicId))
      .where(sql`${topics.title} like 'Merkez%' and ${topics.isMock} = false`);
    expect(faizSnap?.components.search_interest?.available).toBe(false);
    expect(faizSnap?.signals).toBe(2);

    const [trends] = await db
      .select({ id: dataProviders.id })
      .from(dataProviders)
      .where(eq(dataProviders.key, "google_trends"));
    await db
      .update(dataProviders)
      .set({ lastSuccessAt: at(10) })
      .where(eq(dataProviders.id, trends!.id));
    await db.insert(trendSignals).values({
      providerId: trends!.id,
      term: "derbi",
      geo: "TR",
      approxTraffic: 50000,
      observedAt: at(10),
    });

    const r = await build(at(15));
    expect(r.created).toBe(0); // aynı olaylar için yeni konu açılmaz
    const derbi = (await db.select().from(topics).where(eq(topics.isMock, false))).find((t) =>
      t.title.includes("Fenerbahçe"),
    )!;
    expect(derbi.status).toBe("published");
    expect(derbi.reasons.some((x) => x.includes("“derbi”") && x.includes("50.000"))).toBe(true);

    const [snap] = await db
      .select({ components: topicSnapshots.components, signals: topicSnapshots.signalsAvailable })
      .from(topicSnapshots)
      .where(
        sql`${topicSnapshots.topicId} = ${derbi.id} and ${topicSnapshots.capturedAt} = ${at(15).toISOString()}`,
      );
    expect(snap?.components.search_interest?.available).toBe(true);
    expect(snap?.signals).toBe(3);
  });

  it("yeni benzer haber mevcut konuya katılır", async () => {
    await addItem(8, "Merkez Bankası politika faizi kararı sonrası piyasalar", 20);
    await build(at(25));
    const faiz = (await db.select().from(topics).where(eq(topics.isMock, false))).find((t) =>
      t.title.includes("Merkez"),
    )!;
    expect(await db.select().from(topicItems).where(eq(topicItems.topicId, faiz.id))).toHaveLength(
      5,
    );
    expect((await db.select().from(topics).where(eq(topics.isMock, false))).length).toBe(2);
  });

  it("API gerçek konuları sıralı döndürür; örnek konular da korunur", async () => {
    const app = await buildApp({
      repo: createTopicRepository(db),
      cacheTtlSeconds: 0,
      rateLimitMax: 1000,
      logLevel: "silent",
    });
    const list = TopicListResponseSchema.parse(
      (await app.inject("/api/v1/topics?limit=50")).json(),
    );
    const real = list.items.filter((t) => !t.isMock);
    expect(real.map((t) => t.title).some((t) => t.includes("Merkez Bankası"))).toBe(true);
    expect(list.items.some((t) => t.isMock)).toBe(true); // mock'a dokunulmadı
    const slug = real[0]!.slug;
    const detail = TopicDetailResponseSchema.parse(
      (await app.inject(`/api/v1/topics/${slug}`)).json(),
    );
    expect(detail.item.isArchived).toBe(false);
    expect(detail.item.sources.length).toBeGreaterThan(0);
    await app.close();
  });

  it("yeni haber gelmeyince soğur, sonra arşive düşer; arşiv sayfası ve detay açık kalır", async () => {
    let r = await build(at(60 * 8));
    expect(r.cooling).toBeGreaterThan(0);
    r = await build(at(60 * 30));
    expect(r.archived).toBeGreaterThan(0);
    const real = await db.select().from(topics).where(eq(topics.isMock, false));
    expect(real.every((t) => t.status === "archived")).toBe(true);

    const app = await buildApp({
      repo: createTopicRepository(db),
      cacheTtlSeconds: 0,
      rateLimitMax: 1000,
      logLevel: "silent",
    });
    const list = TopicListResponseSchema.parse(
      (await app.inject("/api/v1/topics?limit=50")).json(),
    );
    expect(list.items.some((t) => !t.isMock)).toBe(false);

    const day = ArchiveDayResponseSchema.parse(
      (await app.inject("/api/v1/archive/2026-10-05")).json(),
    );
    const archived = day.items.filter((i) => !i.isMock);
    expect(archived).toHaveLength(2);
    const detail = TopicDetailResponseSchema.parse(
      (await app.inject(`/api/v1/topics/${archived[0]!.slug}`)).json(),
    );
    expect(detail.item.isArchived).toBe(true);
    expect(detail.item.rank).toBeNull();

    expect((await app.inject("/api/v1/archive/2026-13-40")).statusCode).toBe(404);
    expect((await app.inject("/api/v1/archive/2099-01-01")).statusCode).toBe(404);
    expect((await app.inject("/api/v1/archive/2020-01-01")).statusCode).toBe(404);
    expect((await app.inject("/api/v1/archive/..%2F..%2Fetc")).statusCode).toBe(404);
    await app.close();
  });
});
