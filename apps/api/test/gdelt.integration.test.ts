// GDELT: güncel trend terimleri → haberler → trend konusunu açıklar.
// Gerçek PostgreSQL, sahte ağ. Yalnızca TEST_DATABASE_URL tanımlıysa çalışır ve veritabanını SIFIRLAR.
import {
  createDb,
  dataProviders,
  runMigrations,
  seedDatabase,
  topicItems,
  topics,
  trendNewsLinks,
  trendNewsSearches,
  trendSignals,
  type Database,
} from "@gundemci/db";
import { TopicListResponseSchema } from "@gundemci/shared";
import { eq, sql } from "drizzle-orm";
import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.ts";
import { runProvider, type RunnerDeps } from "../src/ingest/runner.ts";
import type { Fetcher } from "../src/ingest/types.ts";
import { clearRobotsCache } from "../src/lib/robots.ts";
import { SafeFetchError } from "../src/lib/safe-http.ts";
import { createTopicRepository } from "../src/modules/topics/repository.ts";
import { buildTopics } from "../src/topics-pipeline/pipeline.ts";

const URL_ = process.env.TEST_DATABASE_URL;
const silent = { info() {}, warn() {}, error() {} };
const NOW = new Date("2026-10-05T09:00:00Z");

const articles = (items: { title: string; domain: string; id: string }[]) =>
  Buffer.from(
    JSON.stringify({
      articles: items.map((i) => ({
        url: `https://www.${i.domain}/haber/${i.id}`,
        title: i.title,
        seendate: "20261005T080000Z",
        domain: i.domain,
      })),
    }),
  );

function fakeFetcher(robots: string | null = null) {
  const calls: string[] = [];
  const fn: Fetcher = async (url, policy) => {
    calls.push(url);
    const u = new URL(url);
    if (!policy.isHostAllowed(u.hostname)) throw new SafeFetchError("blocked_host", "izin dışı");
    if (u.pathname === "/robots.txt") {
      if (robots === null) throw new SafeFetchError("http_error", "HTTP 404", 404);
      return { status: 200, finalUrl: url, contentType: "text/plain", body: Buffer.from(robots) };
    }
    const q = u.searchParams.get("query") ?? "";
    const body = q.startsWith("togg")
      ? articles([
          { title: "Togg'dan ekim ayına özel kampanya", domain: "hurriyet.com.tr", id: "a1" },
          { title: "Togg T6X teslimatları başladı", domain: "ntv.com.tr", id: "a2" },
          { title: "Elektrikli araç pazarı büyüyor", domain: "sabah.com.tr", id: "a3" }, // terim yok
        ])
      : Buffer.from("{}");
    return { status: 200, finalUrl: url, contentType: "application/json", body };
  };
  return { fn, calls };
}

describe.skipIf(!URL_)("GDELT entegrasyonu", () => {
  let db: Database;
  let client: postgres.Sql;
  let close: () => Promise<void>;
  const deps = (fetcher: Fetcher, now = NOW): RunnerDeps => ({
    db,
    client,
    log: silent,
    fetcher,
    now: () => now,
  });

  beforeAll(async () => {
    const url = URL_ as string;
    if (!new URL(url).pathname.endsWith("_test"))
      throw new Error("veritabanı adı '_test' ile bitmeli");
    ({ db, client, close } = createDb(url, { max: 5 }));
    await db.execute(sql`drop schema if exists drizzle cascade`);
    await db.execute(sql`drop schema public cascade`);
    await db.execute(sql`create schema public`);
    await runMigrations(url);
    await seedDatabase(db, { includeMock: false, now: NOW });
    await db
      .update(dataProviders)
      .set({ config: { requestDelayMs: 0, perTermMinutes: 60, maxTermsPerRun: 15 } })
      .where(eq(dataProviders.key, "gdelt_news"));
    const [trends] = await db
      .update(dataProviders)
      .set({ lastSuccessAt: new Date(NOW.getTime() - 5 * 60_000) })
      .where(eq(dataProviders.key, "google_trends"))
      .returning({ id: dataProviders.id });
    await db.insert(trendSignals).values(
      ["togg", "trendyol", "sözcü", "deprem", "adana deprem", "f1"].map((term, i) => ({
        providerId: trends!.id,
        term,
        geo: "TR",
        approxTraffic: 10000 * (i + 1),
        observedAt: new Date(NOW.getTime() - 5 * 60_000),
      })),
    );
  });

  beforeEach(() => clearRobotsCache());

  afterAll(async () => {
    await close?.();
  });

  it("seed: GDELT sağlayıcısı kapalı başlar; kaldırılan Google Haberler sağlayıcısı yok", async () => {
    // Eski kurulumda kalan kayıt yeniden seed ile silinir
    await db
      .insert(dataProviders)
      .values({ key: "google_news_search", kind: "news", name: "Google Haberler", config: {} });
    await seedDatabase(db, { includeMock: false, now: NOW });
    const keys = (await db.select({ key: dataProviders.key }).from(dataProviders)).map(
      (p) => p.key,
    );
    expect(keys).toContain("gdelt_news");
    expect(keys).not.toContain("google_news_search");
  });

  it("robots.txt izin vermiyorsa hiçbir arama yapılmaz", async () => {
    const f = fakeFetcher("User-agent: *\nDisallow: /api/");
    const r = await runProvider(deps(f.fn), "gdelt_news", { force: true });
    expect(r.errorCode).toBe("robots_disallowed");
    expect(f.calls.every((c) => c.endsWith("/robots.txt"))).toBe(true);
  });

  it("güncel terimler aranır (elenenler ve çok kısa olanlar hariç); yalnızca başlığında terim geçenler", async () => {
    const f = fakeFetcher(); // robots.txt yok (404) → izinli
    const r = await runProvider(deps(f.fn), "gdelt_news", { force: true });
    expect(r.status).toBe("success");
    const queries = f.calls
      .filter((c) => c.includes("/api/v2/doc/doc"))
      .map((c) => new URL(c).searchParams.get("query"))
      .sort();
    expect(queries).toEqual([
      '"adana deprem" sourcelang:turkish',
      "deprem sourcelang:turkish",
      "togg sourcelang:turkish",
    ]);
    expect(
      await db.select().from(trendNewsLinks).where(eq(trendNewsLinks.trendKey, "togg")),
    ).toHaveLength(2);
    const [s] = await db
      .select()
      .from(trendNewsSearches)
      .where(eq(trendNewsSearches.trendKey, "togg"));
    expect(s?.resultCount).toBe(2);
  });

  it("aynı terim bir saat dolmadan tekrar aranmaz", async () => {
    const f = fakeFetcher();
    await runProvider(deps(f.fn, new Date(NOW.getTime() + 20 * 60_000)), "gdelt_news", {
      force: true,
    });
    expect(f.calls.filter((c) => c.includes("/api/v2/doc/doc"))).toHaveLength(0);
  });

  it("bulunan haberler trend konusunu açıklar; kart başlığında bilinen yayıncı adı", async () => {
    await buildTopics({ db, client, log: silent, now: () => NOW });
    const [togg] = await db.select().from(topics).where(eq(topics.title, "Togg"));
    expect(togg).toBeDefined();
    expect(await db.select().from(topicItems).where(eq(topicItems.topicId, togg!.id))).toHaveLength(
      2,
    );
    const app = await buildApp({
      repo: createTopicRepository(db),
      cacheTtlSeconds: 0,
      rateLimitMax: 1000,
      logLevel: "silent",
    });
    const list = TopicListResponseSchema.parse((await app.inject("/api/v1/topics")).json());
    // Haberi bulunamayan aramalar ("deprem", "adana deprem") listelenmez
    expect(list.items.map((t) => t.title)).toEqual(["Togg"]);
    expect(list.items[0]?.headline?.source).toMatch(/Hürriyet|NTV/);
    await app.close();
  });

  it("429 alınırsa aynı arama bir kez daha denenir; yine 429 ise tur durur", async () => {
    await db.delete(trendNewsSearches);
    const calls: string[] = [];
    let searches = 0;
    const flaky: Fetcher = async (url) => {
      calls.push(url);
      if (url.endsWith("/robots.txt")) throw new SafeFetchError("http_error", "HTTP 404", 404);
      searches++;
      // 1. arama: önce 429, tekrar denemede başarılı; 2. arama: iki kez 429
      if (searches === 1 || searches >= 3)
        return {
          status: 200,
          finalUrl: url,
          contentType: "text/plain",
          body: Buffer.from("Please limit requests to one every 5 seconds."),
        };
      return {
        status: 200,
        finalUrl: url,
        contentType: "application/json",
        body: Buffer.from("{}"),
      };
    };
    const r = await runProvider(deps(flaky), "gdelt_news", { force: true });
    expect(r.status).toBe("partial");
    expect(r.details.map((d) => d.ok)).toEqual([true, false]);
    expect(searches).toBe(4); // 1+1 (başarılı) + 2 (vazgeçildi), kalan terim aranmadı
    // "togg" artık haberle açıklandığı için hiç aranmadı
    expect(calls.some((c) => c.includes("togg"))).toBe(false);
  });
});
