// Gerçek PostgreSQL üzerinde migration + seed + kısıt testleri.
// Yalnızca TEST_DATABASE_URL tanımlıysa çalışır. Veritabanını SIFIRLAR; bu yüzden
// veritabanı adı "_test" ile bitmek zorundadır (geliştirme verisini yanlışlıkla silmemek için).
import { count, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type Database } from "../src/client.js";
import { runMigrations } from "../src/migrator.js";
import {
  adminUsers,
  categories,
  dataProviders,
  publishers,
  sourceItems,
  timelineEvents,
  topics,
  topicSnapshots,
} from "../src/schema.js";
import { seedDatabase } from "../src/seed/index.js";
import { MOCK_TOPICS } from "../src/seed/mock-data.js";
import { CATEGORIES, PUBLISHERS } from "../src/seed/reference-data.js";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

describe.skipIf(!TEST_DATABASE_URL)("veritabanı entegrasyonu", () => {
  let db: Database;
  let close: () => Promise<void>;

  beforeAll(async () => {
    const url = TEST_DATABASE_URL as string;
    const dbName = new URL(url).pathname.slice(1);
    if (!dbName.endsWith("_test")) {
      throw new Error("TEST_DATABASE_URL veritabanı adı '_test' ile bitmeli");
    }
    ({ db, close } = createDb(url, { max: 2 }));
    await db.execute(sql`drop schema if exists drizzle cascade`);
    await db.execute(sql`drop schema public cascade`);
    await db.execute(sql`create schema public`);
    await runMigrations(url);
  });

  afterAll(async () => {
    await close?.();
  });

  it("migration'lar tekrar çalıştırılabilir", async () => {
    await expect(runMigrations(TEST_DATABASE_URL as string)).resolves.toBeUndefined();
  });

  it("seed referans ve işaretli örnek veriyi yükler", async () => {
    const result = await seedDatabase(db, { includeMock: true });
    expect(result.mockTopics).toBe(MOCK_TOPICS.length);

    const [cat] = await db.select({ n: count() }).from(categories);
    expect(cat?.n).toBe(CATEGORIES.length);

    const realPublishers = await db
      .select({ n: count() })
      .from(publishers)
      .where(eq(publishers.isMock, false));
    expect(realPublishers[0]?.n).toBe(PUBLISHERS.length);

    // Tüm konular, snapshot'lar ve kaynaklar örnek olarak işaretli olmalı
    const unmarkedTopics = await db.select().from(topics).where(eq(topics.isMock, false));
    expect(unmarkedTopics).toHaveLength(0);
    const unmarkedSnapshots = await db
      .select()
      .from(topicSnapshots)
      .where(eq(topicSnapshots.isMock, false));
    expect(unmarkedSnapshots).toHaveLength(0);
    const unmarkedItems = await db.select().from(sourceItems).where(eq(sourceItems.isMock, false));
    expect(unmarkedItems).toHaveLength(0);

    // Örnek kaynak bağlantıları yalnızca ayrılmış test alan adına gider
    const items = await db.select({ url: sourceItems.url }).from(sourceItems);
    for (const item of items) expect(new URL(item.url).hostname).toBe("example.org");

    // Veri sağlayıcıları kapalı başlar (aşama 7'ye kadar ağdan veri çekilmez)
    const enabled = await db.select().from(dataProviders).where(eq(dataProviders.isEnabled, true));
    expect(enabled).toHaveLength(0);

    const [timeline] = await db.select({ n: count() }).from(timelineEvents);
    expect(timeline?.n).toBeGreaterThan(0);
  });

  it("seed tekrar çalıştırılabilir (idempotent), kopya oluşturmaz", async () => {
    await seedDatabase(db, { includeMock: true });
    const [t] = await db.select({ n: count() }).from(topics);
    expect(t?.n).toBe(MOCK_TOPICS.length);
    const [s] = await db.select({ n: count() }).from(topicSnapshots);
    expect(s?.n).toBe(MOCK_TOPICS.length * 2);
    const [c] = await db.select({ n: count() }).from(categories);
    expect(c?.n).toBe(CATEGORIES.length);
  });

  it("admin değişikliklerinin üzerine yazmaz", async () => {
    await db.update(publishers).set({ isActive: false }).where(eq(publishers.domain, "aa.com.tr"));
    await seedDatabase(db, { includeMock: true });
    const [aa] = await db.select().from(publishers).where(eq(publishers.domain, "aa.com.tr"));
    expect(aa?.isActive).toBe(false);
  });

  it("includeMock=false örnek verileri tamamen temizler, gerçek veriye dokunmaz", async () => {
    await seedDatabase(db, { includeMock: false });
    const [t] = await db.select({ n: count() }).from(topics);
    expect(t?.n).toBe(0);
    const [i] = await db.select({ n: count() }).from(sourceItems);
    expect(i?.n).toBe(0);
    const mockPublishers = await db.select().from(publishers).where(eq(publishers.isMock, true));
    expect(mockPublishers).toHaveLength(0);
    const [p] = await db.select({ n: count() }).from(publishers);
    expect(p?.n).toBe(PUBLISHERS.length);
    await seedDatabase(db, { includeMock: true });
  });

  describe("kısıtlar geçersiz veriyi reddeder", () => {
    const categoryId = async () => {
      const [row] = await db.select({ id: categories.id }).from(categories).limit(1);
      return row!.id;
    };

    it("geçersiz slug", async () => {
      await expect(
        db.insert(topics).values({
          slug: "Geçersiz Slug!",
          title: "x",
          categoryId: await categoryId(),
        }),
      ).rejects.toThrow();
    });

    it("0–100 dışı skor", async () => {
      const [topic] = await db.select({ id: topics.id }).from(topics).limit(1);
      await expect(
        db.insert(topicSnapshots).values({ topicId: topic!.id, score: 101 }),
      ).rejects.toThrow();
    });

    it("https olmayan feed adresi", async () => {
      await expect(
        db.insert(publishers).values({
          name: "x",
          domain: "x.invalid",
          homepageUrl: "https://x.invalid",
          feedUrl: "file:///etc/passwd",
        }),
      ).rejects.toThrow();
    });

    it("javascript: şemalı kaynak bağlantısı", async () => {
      const [provider] = await db.select({ id: dataProviders.id }).from(dataProviders).limit(1);
      await expect(
        db.insert(sourceItems).values({
          providerId: provider!.id,
          url: "javascript:alert(1)",
          urlHash: "a".repeat(64),
          title: "x",
        }),
      ).rejects.toThrow();
    });

    it("büyük/küçük harf farkıyla aynı admin e-postası", async () => {
      await db.insert(adminUsers).values({ email: "admin@example.org", passwordHash: "x" });
      await expect(
        db.insert(adminUsers).values({ email: "ADMIN@example.org", passwordHash: "x" }),
      ).rejects.toThrow();
    });
  });
});
