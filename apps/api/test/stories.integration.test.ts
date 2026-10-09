// Ortak haberler: en az 3 sitede yayımlanan haber listeye girer, yeni siteler büyüme olarak kaydedilir,
// liste site sayısına göre sıralanır. Gerçek PostgreSQL.
// Yalnızca TEST_DATABASE_URL tanımlıysa çalışır ve veritabanını SIFIRLAR (adı "_test" ile bitmeli).
import { createHash } from "node:crypto";
import {
  createDb,
  dataProviders,
  newsStories,
  publishers,
  runMigrations,
  seedDatabase,
  sourceItems,
  type Database,
} from "@gundemci/db";
import { NewsStoryDetailResponseSchema, NewsStoryListResponseSchema } from "@gundemci/shared";
import { asc, eq, sql } from "drizzle-orm";
import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.ts";
import { createTopicRepository } from "../src/modules/topics/repository.ts";
import { buildTopics } from "../src/topics-pipeline/pipeline.ts";
import { describeSpread, storyGrowth } from "../src/topics-pipeline/stories.ts";

const URL_ = process.env.TEST_DATABASE_URL;
const silent = { info() {}, warn() {}, error() {} };
const T0 = new Date("2026-10-05T09:00:00Z");
const at = (minutes: number) => new Date(T0.getTime() + minutes * 60_000);

describe("storyGrowth", () => {
  it("yalnızca site sayısı arttıysa büyüme verir", () => {
    expect(storyGrowth(3, 5)).toBe(2);
    expect(storyGrowth(4, 4)).toBeNull();
    expect(storyGrowth(5, 4)).toBeNull();
  });
});

describe("describeSpread", () => {
  const item = (name: string, published: number, added: number, n = 0) => ({
    publisherName: name,
    title: `${name} başlık ${n}`,
    url: `https://${name.toLowerCase()}.example/${n}`,
    publishedAt: at(published),
    fetchedAt: at(published + 2),
    addedAt: at(added),
  });

  it("ilk yayımlayan site, taramalar ve hız ölçüleri", () => {
    const s = describeSpread(
      [
        item("B", -20, 10),
        item("A", -30, 10),
        item("C", 5, 10),
        item("A", 15, 30, 1), // aynı site ikinci kez: yeni site sayılmaz
        item("D", 22, 30),
        item("E", 50, 60),
      ],
      at(60),
    );
    expect(s.sites.map((x) => x.name)).toEqual(["A", "B", "C", "D", "E"]);
    expect(s.sites[0]!.url).toBe("https://a.example/0");
    expect(s.scans.map((x) => [x.at.toISOString(), x.sites])).toEqual([
      [at(10).toISOString(), ["A", "B", "C"]],
      [at(30).toISOString(), ["D"]],
      [at(60).toISOString(), ["E"]],
    ]);
    expect(s.minutesToThreeSites).toBe(35);
    expect(s.sitesInFirstHour).toBe(4); // A, B, C, D (E: 80 dk sonra)
    expect(s.sitesInLastHour).toBe(3); // C, D, E
    expect(s.spanMinutes).toBe(80);
  });

  it("boş liste", () => {
    const s = describeSpread([], at(0));
    expect(s.sites).toEqual([]);
    expect(s.minutesToThreeSites).toBeNull();
    expect(s.spanMinutes).toBe(0);
  });
});

describe.skipIf(!URL_)("ortak haberler", () => {
  let db: Database;
  let client: postgres.Sql;
  let close: () => Promise<void>;
  let pubs: { id: number; domain: string }[];
  let rssProviderId: number;
  const build = (now: Date) => buildTopics({ db, client, log: silent, now: () => now });

  async function addItem(pubIndex: number, title: string, minutes: number) {
    const p = pubs[pubIndex]!;
    const url = `https://www.${p.domain}/gundem/${createHash("md5")
      .update(title + pubIndex + minutes)
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

  const quake = [
    "Malatya'da 5,2 büyüklüğünde deprem meydana geldi",
    "Malatya'da 5,2 büyüklüğünde deprem: AFAD açıklama yaptı",
    "AFAD duyurdu: Malatya'da 5,2 büyüklüğünde deprem",
    "Malatya deprem 5,2 büyüklüğünde, çevre illerde de hissedildi",
    "Son dakika: Malatya'da 5,2 büyüklüğünde deprem",
  ];
  const bridge = [
    "Çanakkale Köprüsü geçiş ücretine yeni yıl zammı geldi",
    "Çanakkale Köprüsü geçiş ücreti zamlandı",
    "Çanakkale Köprüsü geçiş ücretine zam: yeni tarife belli oldu",
    "Çanakkale Köprüsü geçiş ücreti yeni yılda zamlı",
  ];

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
    const [rss] = await db
      .select({ id: dataProviders.id })
      .from(dataProviders)
      .where(eq(dataProviders.key, "rss_news"));
    rssProviderId = rss!.id;
    await db
      .update(dataProviders)
      .set({ lastSuccessAt: at(30) })
      .where(eq(dataProviders.id, rssProviderId));
  });

  afterAll(async () => {
    await close?.();
  });

  it("2 sitede yayımlanan haber listeye girmez", async () => {
    await addItem(0, quake[0]!, -30);
    await addItem(1, quake[1]!, -25);
    const r = await build(at(0));
    expect(r.storiesCreated).toBe(0);
    expect(await db.select().from(newsStories)).toHaveLength(0);
  });

  it("3. site yayımlayınca listeye girer (büyüme notu yok)", async () => {
    await addItem(2, quake[2]!, 5);
    const r = await build(at(10));
    expect(r.storiesCreated).toBe(1);
    const [story] = await db.select().from(newsStories);
    expect(story!.publisherCount).toBe(3);
    expect(story!.listedAt.toISOString()).toBe(at(10).toISOString());
    expect(story!.lastGrowthAt).toBeNull();
    expect(story!.firstItemAt.toISOString()).toBe(at(-30).toISOString());
  });

  it("yeni haber gelmeyen taramada değişmez", async () => {
    const r = await build(at(20));
    expect(r.storiesCreated).toBe(0);
    expect(r.storiesGrown).toBe(0);
  });

  it("sonraki taramada başka siteler de yayımlarsa büyüme kaydedilir", async () => {
    await addItem(3, quake[3]!, 22);
    await addItem(4, quake[4]!, 24);
    // Aynı site ikinci kez yazınca site sayısı artmaz
    await addItem(0, "Malatya'da 5,2 büyüklüğünde deprem: hasar tespit çalışması", 26);
    const r = await build(at(30));
    expect(r.storiesGrown).toBe(1);
    const [story] = await db.select().from(newsStories);
    expect(story!.publisherCount).toBe(5);
    expect(story!.lastGrowthBy).toBe(2);
    expect(story!.lastGrowthAt!.toISOString()).toBe(at(30).toISOString());
  });

  it("API: site sayısına göre sıralı, her site bir kez; 24 saatten eski haber yok", async () => {
    for (const [i, title] of bridge.entries()) await addItem(5 + i, title, 32 + i);
    // 24 saatten eski bir ortak haber (listede görünmemeli)
    await db.insert(newsStories).values({
      title: "Eski haber",
      publisherCount: 9,
      firstItemAt: at(-26 * 60),
      listedAt: at(-26 * 60),
      updatedAt: at(-26 * 60),
    });
    await build(at(40));

    const app = await buildApp({
      repo: createTopicRepository(db),
      cacheTtlSeconds: 0,
      rateLimitMax: 1000,
      logLevel: "silent",
      clock: () => at(41),
    });
    try {
      const res = await app.inject({ method: "GET", url: "/api/v1/stories" });
      expect(res.statusCode).toBe(200);
      const body = NewsStoryListResponseSchema.parse(res.json());
      expect(body.items.map((s) => s.publisherCount)).toEqual([5, 4]);
      const [first, second] = body.items;
      expect(first!.title).toContain("Malatya");
      expect(first!.lastGrowthBy).toBe(2);
      expect(first!.sources).toHaveLength(5);
      expect(new Set(first!.sources.map((s) => s.name)).size).toBe(5);
      expect(second!.title).toContain("Çanakkale");
      expect(second!.lastGrowthAt).toBeNull();
      expect(body.scannedAt).toBe(at(30).toISOString());

      expect(
        (await app.inject({ method: "GET", url: "/api/v1/stories?limit=16" })).statusCode,
      ).toBe(400);
      const one = NewsStoryListResponseSchema.parse(
        (await app.inject({ method: "GET", url: "/api/v1/stories?limit=1" })).json(),
      );
      expect(one.items).toHaveLength(1);

      // Detay: ilk yayımlayan site, taramalar, tüm haberler
      const detailRes = await app.inject({ method: "GET", url: `/api/v1/stories/${first!.id}` });
      expect(detailRes.statusCode).toBe(200);
      const detail = NewsStoryDetailResponseSchema.parse(detailRes.json());
      expect(detail.story.publisherCount).toBe(5);
      expect(detail.sites).toHaveLength(5);
      expect(detail.sites[0]!.publishedAt).toBe(at(-30).toISOString());
      expect(detail.items).toHaveLength(6); // aynı siteden iki haber
      expect(detail.scans.map((x) => x.sites.length)).toEqual([3, 2]);
      expect(detail.scans[0]!.at).toBe(at(10).toISOString());
      expect(detail.spread.minutesToThreeSites).toBe(35);

      for (const bad of ["0", "abc", "1;drop", "99999999", "12345678901234567890"]) {
        const r = await app.inject({ method: "GET", url: `/api/v1/stories/${bad}` });
        expect(r.statusCode, bad).toBe(404);
      }
    } finally {
      await app.close();
    }
  });
});
