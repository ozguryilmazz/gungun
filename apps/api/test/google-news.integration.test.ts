// Google Haberler araması: güncel trend terimleri → haberler → trend konusunu açıklar.
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

function rss(items: { title: string; source: string; id: string }[]) {
  return Buffer.from(
    `<rss><channel>${items
      .map(
        (i) =>
          `<item><title>${i.title} - ${i.source}</title><link>https://news.google.com/rss/articles/${i.id}?oc=5</link><pubDate>Mon, 05 Oct 2026 08:00:00 GMT</pubDate><source url="https://x.example">${i.source}</source></item>`,
      )
      .join("")}</channel></rss>`,
  );
}

function fakeFetcher(robots = "User-agent: *\nDisallow: /search\nAllow: /rss/search") {
  const calls: string[] = [];
  const fn: Fetcher = async (url, policy) => {
    calls.push(url);
    const u = new URL(url);
    if (!policy.isHostAllowed(u.hostname)) throw new SafeFetchError("blocked_host", "izin dışı");
    if (u.pathname === "/robots.txt")
      return { status: 200, finalUrl: url, contentType: "text/plain", body: Buffer.from(robots) };
    const q = u.searchParams.get("q") ?? "";
    const body = q.startsWith("trendyol")
      ? rss([
          { title: "Trendyol'dan büyük indirim kampanyası", source: "Hürriyet", id: "a1" },
          { title: "Trendyol'da erişim sorunu yaşandı", source: "NTV", id: "a2" },
          { title: "E-ticarette yeni dönem", source: "Sabah", id: "a3" }, // terim yok → alınmaz
        ])
      : rss([]);
    return { status: 200, finalUrl: url, contentType: "application/rss+xml", body };
  };
  return { fn, calls };
}

describe.skipIf(!URL_)("Google Haberler araması entegrasyonu", () => {
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
      .set({ config: { requestDelayMs: 0, perTermMinutes: 60, maxTermsPerRun: 25 } })
      .where(eq(dataProviders.key, "google_news_search"));
    const [trends] = await db
      .update(dataProviders)
      .set({ lastSuccessAt: new Date(NOW.getTime() - 5 * 60_000) })
      .where(eq(dataProviders.key, "google_trends"))
      .returning({ id: dataProviders.id });
    await db.insert(trendSignals).values(
      ["trendyol", "sözcü", "deprem"].map((term, i) => ({
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

  it("robots.txt izin vermiyorsa hiçbir arama yapılmaz", async () => {
    const f = fakeFetcher("User-agent: *\nDisallow: /");
    const r = await runProvider(deps(f.fn), "google_news_search", { force: true });
    expect(r.status).toBe("failed");
    expect(r.errorCode).toBe("robots_disallowed");
    expect(f.calls.every((c) => c.endsWith("/robots.txt"))).toBe(true);
  });

  it("güncel trend terimleri aranır (medya adı hariç); yalnızca başlığında terim geçen haberler alınır", async () => {
    const f = fakeFetcher();
    const r = await runProvider(deps(f.fn), "google_news_search", { force: true });
    expect(r.status).toBe("success");
    const searchedTerms = f.calls
      .filter((c) => c.includes("/rss/search"))
      .map((c) => new URL(c).searchParams.get("q"));
    expect(searchedTerms.sort()).toEqual(["deprem when:1d", "trendyol when:1d"]);
    const links = await db
      .select()
      .from(trendNewsLinks)
      .where(eq(trendNewsLinks.trendKey, "trendyol"));
    expect(links).toHaveLength(2);
    const [s] = await db
      .select()
      .from(trendNewsSearches)
      .where(eq(trendNewsSearches.trendKey, "trendyol"));
    expect(s?.resultCount).toBe(2);
  });

  it("aynı terim bir saat dolmadan tekrar aranmaz", async () => {
    const f = fakeFetcher();
    await runProvider(deps(f.fn, new Date(NOW.getTime() + 20 * 60_000)), "google_news_search", {
      force: true,
    });
    expect(f.calls.filter((c) => c.includes("/rss/search"))).toHaveLength(0);
  });

  it("bulunan haberler trend konusunu açıklar: kaynaklı başlık ve açıklananlar arasında sıra", async () => {
    await buildTopics({ db, client, log: silent, now: () => NOW });
    const [trendyol] = await db.select().from(topics).where(eq(topics.title, "Trendyol"));
    expect(trendyol).toBeDefined();
    expect(
      await db.select().from(topicItems).where(eq(topicItems.topicId, trendyol!.id)),
    ).toHaveLength(2);

    const app = await buildApp({
      repo: createTopicRepository(db),
      cacheTtlSeconds: 0,
      rateLimitMax: 1000,
      logLevel: "silent",
    });
    const list = TopicListResponseSchema.parse((await app.inject("/api/v1/topics")).json());
    // Trendyol aramada daha düşük ama açıklandığı için açıklanamayan "Deprem"in önünde
    expect(list.items.map((t) => t.title)).toEqual(["Trendyol", "Deprem"]);
    expect(list.items[0]?.headline?.source).toMatch(/Hürriyet|NTV/);
    expect(list.items[0]?.headline?.title).not.toContain(" - ");
    await app.close();
  });
});
