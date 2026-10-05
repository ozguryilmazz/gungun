// YouTube: sağlayıcı → veritabanı → API ve gündem skoruna sosyal sinyal. Gerçek PostgreSQL, sahte ağ.
// Yalnızca TEST_DATABASE_URL tanımlıysa çalışır ve veritabanını SIFIRLAR (adı "_test" ile bitmeli).
import { readFileSync } from "node:fs";
import {
  createDb,
  dataProviders,
  fetchRuns,
  runMigrations,
  seedDatabase,
  topics,
  topicSnapshots,
  trendSignals,
  youtubeVideos,
  type Database,
} from "@gundemci/db";
import { YoutubeListResponseSchema } from "@gundemci/shared";
import { desc, eq, sql } from "drizzle-orm";
import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.ts";
import { runProvider, type RunnerDeps } from "../src/ingest/runner.ts";
import type { Fetcher } from "../src/ingest/types.ts";
import type { FetchPolicy } from "../src/lib/safe-http.ts";
import { SafeFetchError } from "../src/lib/safe-http.ts";
import { createTopicRepository } from "../src/modules/topics/repository.ts";
import { buildTopics } from "../src/topics-pipeline/pipeline.ts";

const URL_ = process.env.TEST_DATABASE_URL;
const silent = { info() {}, warn() {}, error() {} };
const KEY = "AIzaTestKey_000000000000000000000000000";
const fixture = readFileSync(new URL("./fixtures/youtube.json", import.meta.url));

function fakeFetcher(status = 200) {
  const calls: { url: string; policy: FetchPolicy }[] = [];
  const fn: Fetcher = async (url, policy) => {
    calls.push({ url, policy });
    if (!policy.isHostAllowed(new URL(url).hostname))
      throw new SafeFetchError("blocked_host", "izin dışı");
    if (status !== 200) throw new SafeFetchError("http_error", `HTTP ${status}`, status);
    return { status: 200, finalUrl: url, contentType: "application/json", body: fixture };
  };
  return { fn, calls };
}

describe.skipIf(!URL_)("YouTube entegrasyonu", () => {
  let db: Database;
  let client: postgres.Sql;
  let close: () => Promise<void>;
  const deps = (fetcher: Fetcher, now: Date, key: string | null = KEY): RunnerDeps => ({
    db,
    client,
    log: silent,
    fetcher,
    now: () => now,
    secrets: key === null ? {} : { youtubeApiKey: key },
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
    await seedDatabase(db, { includeMock: false });
  });

  afterAll(async () => {
    await close?.();
  });

  it("sağlayıcı kapalı başlar", async () => {
    const [p] = await db
      .select()
      .from(dataProviders)
      .where(eq(dataProviders.key, "youtube_trending"));
    expect(p?.isEnabled).toBe(false);
    expect(p?.kind).toBe("social");
  });

  it("anahtar yoksa istek atılmaz ve anlaşılır hata kaydedilir", async () => {
    const f = fakeFetcher();
    const r = await runProvider(deps(f.fn, new Date(), null), "youtube_trending", {
      force: true,
    });
    expect(r.status).toBe("failed");
    expect(r.errorCode).toBe("missing_key");
    expect(f.calls).toHaveLength(0);
  });

  it("anahtar adrese değil başlığa konur; videolar kaydedilir", async () => {
    const f = fakeFetcher();
    const r = await runProvider(deps(f.fn, new Date()), "youtube_trending", { force: true });
    expect(r.status).toBe("success");
    expect(r.itemsFetched).toBe(3);
    const call = f.calls[0]!;
    expect(call.url).not.toContain(KEY);
    expect(new URL(call.url).hostname).toBe("www.googleapis.com");
    expect(new URL(call.url).searchParams.get("regionCode")).toBe("TR");
    expect(call.policy.headers?.["x-goog-api-key"]).toBe(KEY);
    expect(call.policy.isHostAllowed("evil.example")).toBe(false);
  });

  it("hata kaydında anahtar yer almaz", async () => {
    const f = fakeFetcher(403);
    const r = await runProvider(deps(f.fn, new Date()), "youtube_trending", { force: true });
    expect(r.status).toBe("failed");
    expect(r.errorMessage).toContain("kota");
    const runs = await db.select().from(fetchRuns).orderBy(desc(fetchRuns.id)).limit(5);
    expect(JSON.stringify(runs)).not.toContain(KEY);
  });

  it("30 günden eski kayıtlar silinir", async () => {
    const [p] = await db
      .select({ id: dataProviders.id })
      .from(dataProviders)
      .where(eq(dataProviders.key, "youtube_trending"));
    await db.insert(youtubeVideos).values({
      providerId: p!.id,
      videoId: "eskiVideo01",
      observedAt: new Date(Date.now() - 31 * 86_400_000),
      rank: 1,
      title: "Eski",
      channelTitle: "Kanal",
    });
    await runProvider(deps(fakeFetcher().fn, new Date()), "youtube_trending", { force: true });
    const old = await db
      .select()
      .from(youtubeVideos)
      .where(eq(youtubeVideos.videoId, "eskiVideo01"));
    expect(old).toHaveLength(0);
  });

  it("API: en güncel liste sırasıyla, YouTube bağlantısıyla", async () => {
    const app = await buildApp({
      repo: createTopicRepository(db),
      cacheTtlSeconds: 0,
      rateLimitMax: 1000,
      logLevel: "silent",
    });
    const res = await app.inject("/api/v1/youtube?limit=2");
    expect(res.statusCode).toBe(200);
    const body = YoutubeListResponseSchema.parse(res.json());
    expect(body.items.map((v) => v.rank)).toEqual([1, 2]);
    expect(body.items[0]?.url).toBe("https://www.youtube.com/watch?v=abcDEF12345");
    expect(body.observedAt).not.toBeNull();
    expect((await app.inject("/api/v1/youtube?limit=500")).statusCode).toBe(400);
    expect((await app.inject("/api/v1/youtube?x=1")).statusCode).toBe(400);
    await app.close();
  });

  it("gündem skoru: trend terimi YouTube'da geçiyorsa sosyal sinyal ölçülür", async () => {
    const now = new Date();
    const [trends] = await db
      .update(dataProviders)
      .set({ lastSuccessAt: now })
      .where(eq(dataProviders.key, "google_trends"))
      .returning({ id: dataProviders.id });
    await db
      .update(dataProviders)
      .set({ lastSuccessAt: now })
      .where(eq(dataProviders.key, "youtube_trending"));
    await db.insert(trendSignals).values([
      {
        providerId: trends!.id,
        term: "fenerbahçe galatasaray",
        geo: "TR",
        approxTraffic: 50000,
        observedAt: now,
      },
      {
        providerId: trends!.id,
        term: "adana deprem",
        geo: "TR",
        approxTraffic: 20000,
        observedAt: now,
      },
    ]);
    await buildTopics({ db, client, log: silent, now: () => now });

    const social = async (title: string) => {
      const [t] = await db.select().from(topics).where(eq(topics.title, title));
      const [snap] = await db
        .select()
        .from(topicSnapshots)
        .where(eq(topicSnapshots.topicId, t!.id))
        .orderBy(desc(topicSnapshots.capturedAt))
        .limit(1);
      return { topic: t!, social: snap!.components.social };
    };
    const derbi = await social("Fenerbahçe Galatasaray");
    expect(derbi.social?.available).toBe(true);
    expect(derbi.social?.normalized).toBe(1);
    expect(derbi.topic.reasons.some((r) => r.includes("YouTube"))).toBe(true);
    const deprem = await social("Adana Deprem");
    expect(deprem.social?.available).toBe(true);
    expect(deprem.social?.normalized).toBe(0);
  });
});
