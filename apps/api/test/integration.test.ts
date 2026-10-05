// Gerçek PostgreSQL + gerçek repository ile uçtan uca testler.
// Yalnızca TEST_DATABASE_URL tanımlıysa çalışır ve veritabanını SIFIRLAR (adı "_test" ile bitmeli).
import { createDb, runMigrations, seedDatabase, type Database } from "@gundemci/db";
import {
  TopicDetailResponseSchema,
  TopicHistoryResponseSchema,
  TopicListResponseSchema,
} from "@gundemci/shared";
import { sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.ts";
import { createTopicRepository } from "../src/modules/topics/repository.ts";

const URL_ = process.env.TEST_DATABASE_URL;

describe.skipIf(!URL_)("API + PostgreSQL entegrasyonu", () => {
  let db: Database;
  let close: () => Promise<void>;
  let app: FastifyInstance;

  beforeAll(async () => {
    const url = URL_ as string;
    if (!new URL(url).pathname.endsWith("_test"))
      throw new Error("veritabanı adı '_test' ile bitmeli");
    ({ db, close } = createDb(url, { max: 4 }));
    await db.execute(sql`drop schema if exists drizzle cascade`);
    await db.execute(sql`drop schema public cascade`);
    await db.execute(sql`create schema public`);
    await runMigrations(url);
    await seedDatabase(db, { includeMock: true });
    app = await buildApp({
      repo: createTopicRepository(db),
      cacheTtlSeconds: 0,
      rateLimitMax: 1000,
      logLevel: "silent",
    });
  });

  afterAll(async () => {
    await app?.close();
    await close?.();
  });

  it("liste: 8 örnek konu, skora göre sıralı, örnek veri işaretli", async () => {
    const body = TopicListResponseSchema.parse((await app.inject("/api/v1/topics")).json());
    expect(body.items).toHaveLength(8);
    expect(body.meta.isMock).toBe(true);
    expect(body.items[0]).toEqual(
      expect.objectContaining({
        slug: "ornek-yeni-nesil-akilli-telefon-tanitimi",
        rank: 1,
        score: 92,
        previousScore: 55,
        changePct: 67,
        trend: "surging",
        sourceCount: 4,
        signalsAvailable: 3,
        signalsTotal: 4,
      }),
    );
  });

  it("yükselenler az kaynaklı konuyu içermez; düşenler doğru", async () => {
    const rising = TopicListResponseSchema.parse(
      (await app.inject("/api/v1/topics/rising")).json(),
    );
    expect(rising.items.map((t) => t.slug)).not.toContain("ornek-uzay-gorevi-firlatmasi");
    expect(rising.items[0]?.slug).toBe("ornek-yeni-nesil-akilli-telefon-tanitimi");
    const falling = TopicListResponseSchema.parse(
      (await app.inject("/api/v1/topics/falling")).json(),
    );
    expect(falling.items.map((t) => t.slug)).toEqual([
      "ornek-viral-sokak-roportaji",
      "ornek-uluslararasi-iklim-zirvesi",
    ]);
  });

  it("detay: kaynaklar, zaman çizelgesi, eksik sinyal", async () => {
    const telefon = TopicDetailResponseSchema.parse(
      (await app.inject("/api/v1/topics/ornek-yeni-nesil-akilli-telefon-tanitimi")).json(),
    ).item;
    expect(telefon.sources).toHaveLength(4);
    expect(telefon.sources.every((s) => new URL(s.url).hostname === "example.org")).toBe(true);
    expect(telefon.timeline.map((e) => e.type)).toEqual([
      "first_source",
      "news_spread",
      "search_spike",
      "entered_top5",
    ]);

    const uzay = TopicDetailResponseSchema.parse(
      (await app.inject("/api/v1/topics/ornek-uzay-gorevi-firlatmasi")).json(),
    ).item;
    expect(uzay.components.find((c) => c.key === "search_interest")?.available).toBe(false);
    expect(uzay.signalsAvailable).toBe(2);
  });

  it("kategori filtresi gerçek veriyle", async () => {
    const spor = TopicListResponseSchema.parse(
      (await app.inject("/api/v1/topics?category=spor")).json(),
    );
    expect(spor.items.map((t) => t.slug)).toEqual(["ornek-super-lig-derbi-haftasi"]);
  });

  it("skor geçmişi 2 ölçüm", async () => {
    const body = TopicHistoryResponseSchema.parse(
      (await app.inject("/api/v1/topics/ornek-faiz-karari-beklentisi/history")).json(),
    );
    expect(body.items).toHaveLength(2);
  });

  it("gizlenen konu görünmez", async () => {
    await db.execute(
      sql`update topics set status = 'hidden' where slug = 'ornek-dizi-final-bolumu'`,
    );
    expect((await app.inject("/api/v1/topics/ornek-dizi-final-bolumu")).statusCode).toBe(404);
    const list = TopicListResponseSchema.parse((await app.inject("/api/v1/topics")).json());
    expect(list.items.map((t) => t.slug)).not.toContain("ornek-dizi-final-bolumu");
  });

  it("SQL enjeksiyonu denemesi etkisiz", async () => {
    const res = await app.inject("/api/v1/topics/x'%20or%201=1--");
    expect(res.statusCode).toBe(404);
    const [{ n }] = (await db.execute(sql`select count(*)::int as n from topics`)) as unknown as [
      { n: number },
    ];
    expect(n).toBe(8);
  });

  it("veritabanı hazır", async () => {
    expect((await app.inject("/health/ready")).statusCode).toBe(200);
  });
});
