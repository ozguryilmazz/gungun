// Veri çekme zinciri: sağlayıcı → ayrıştırma → veritabanı → durum. Gerçek PostgreSQL, sahte ağ.
// Yalnızca TEST_DATABASE_URL tanımlıysa çalışır ve veritabanını SIFIRLAR (adı "_test" ile bitmeli).
import { readFileSync } from "node:fs";
import {
  createDb,
  dataProviders,
  fetchRuns,
  publishers,
  runMigrations,
  seedDatabase,
  sourceItems,
  trendSignals,
  type Database,
} from "@gundemci/db";
import { StatusResponseSchema } from "@gundemci/shared";
import { count, desc, eq, sql } from "drizzle-orm";
import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.ts";
import { tick } from "../src/ingest/scheduler.ts";
import { runProvider, type RunnerDeps } from "../src/ingest/runner.ts";
import type { Fetcher } from "../src/ingest/types.ts";
import { SafeFetchError } from "../src/lib/safe-http.ts";
import { createTopicRepository } from "../src/modules/topics/repository.ts";

const URL_ = process.env.TEST_DATABASE_URL;
const silent = { info() {}, warn() {}, error() {} };

/** Yayıncının alan adında 3 haber + başka siteye giden 1 bağlantı içeren RSS */
function rssFor(host: string): Buffer {
  const items = [1, 2, 3]
    .map(
      (n) =>
        `<item><title>${host} haber ${n}</title><link>https://${host}/haber-${n}?utm_source=rss</link><pubDate>Mon, 05 Oct 2026 0${n}:00:00 +0000</pubDate></item>`,
    )
    .join("");
  return Buffer.from(
    `<?xml version="1.0"?><rss version="2.0"><channel>${items}<item><title>Tuzak</title><link>https://kotu-site.example/x</link></item></channel></rss>`,
  );
}

const trendsXml = readFileSync(new URL("./fixtures/trends.xml", import.meta.url));

function fakeFetcher(
  options: { failTrends?: boolean; delayMs?: number } = {},
): Fetcher & { calls: string[] } {
  const calls: string[] = [];
  const fn = (async (url: string, policy) => {
    calls.push(url);
    if (options.delayMs) await new Promise((r) => setTimeout(r, options.delayMs));
    const host = new URL(url).hostname;
    if (!policy.isHostAllowed(host)) throw new SafeFetchError("blocked_host", "izin dışı");
    if (host.includes("sozcu")) throw new SafeFetchError("http_error", "HTTP 404", 404);
    if (host.includes("cumhuriyet")) {
      return {
        status: 200,
        finalUrl: url,
        contentType: "text/html",
        body: Buffer.from("<html>bakım</html>"),
      };
    }
    if (host === "trends.google.com") {
      if (options.failTrends) throw new SafeFetchError("timeout", "Zaman aşımı");
      return { status: 200, finalUrl: url, contentType: "application/rss+xml", body: trendsXml };
    }
    // Feed host'u farklı olabilir (feeds.bbci.co.uk) — haber bağlantıları yayıncının alan adında
    const domain = host === "feeds.bbci.co.uk" ? "www.bbc.com" : host;
    return { status: 200, finalUrl: url, contentType: "application/rss+xml", body: rssFor(domain) };
  }) as Fetcher & { calls: string[] };
  fn.calls = calls;
  return fn;
}

describe.skipIf(!URL_)("veri çekme entegrasyonu", () => {
  /** Seed'deki gerçek (örnek olmayan) yayıncı sayısı: kaynak listesi büyüdükçe test değişmesin */
  const publisherCount = async () =>
    (await db.select({ n: count() }).from(publishers).where(eq(publishers.isMock, false)))[0]!.n;
  let db: Database;
  let client: postgres.Sql;
  let close: () => Promise<void>;
  const deps = (fetcher: Fetcher, now?: () => Date): RunnerDeps => ({
    db,
    client,
    log: silent,
    fetcher,
    ...(now ? { now } : {}),
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

  it("kapalı sağlayıcı zorlanmadan çalışmaz", async () => {
    const fetcher = fakeFetcher();
    const result = await runProvider(deps(fetcher), "rss_news");
    expect(result.skipped).toBe("disabled");
    expect(fetcher.calls).toHaveLength(0);
  });

  it("haber RSS: kısmi başarı, kaynak bazında sonuç, alan adı dışı bağlantı atlanır", async () => {
    const result = await runProvider(deps(fakeFetcher()), "rss_news", { force: true });
    expect(result.status).toBe("partial");
    const total = await publisherCount();
    expect(result.details).toHaveLength(total);
    const failed = result.details.filter((d) => !d.ok).map((d) => d.name);
    expect(failed.sort()).toEqual(["Cumhuriyet", "Sözcü"]);
    // Çalışan her kaynak 3 haber (2 kaynak hata verir)
    expect(result.itemsFetched).toBe((total - 2) * 3);
    // Teşhis bilgisi: akıştaki öğe sayısı ve alan adı dışı bağlantı
    const aa = result.details.find((d) => d.name === "Anadolu Ajansı");
    expect(aa).toEqual(
      expect.objectContaining({
        ok: true,
        items: 3,
        parsed: 4,
        offDomain: 1,
        offDomainHosts: ["kotu-site.example"],
      }),
    );

    const urls = (await db.select({ url: sourceItems.url }).from(sourceItems)).map((r) => r.url);
    expect(urls.some((u) => u.includes("kotu-site"))).toBe(false);
    expect(urls.some((u) => u.includes("utm_source"))).toBe(false);

    const [run] = await db.select().from(fetchRuns).orderBy(desc(fetchRuns.id)).limit(1);
    expect(run?.status).toBe("partial");
    expect(run?.errorMessage).toContain(`2/${total}`);
    expect(run?.details).toHaveLength(total);

    // Kısmi başarı sağlayıcıyı "başarılı" sayar
    const [provider] = await db
      .select()
      .from(dataProviders)
      .where(eq(dataProviders.key, "rss_news"));
    expect(provider?.lastSuccessAt).not.toBeNull();
    expect(provider?.consecutiveFailures).toBe(0);
  });

  it("aynı haberler ikinci çekmede tekrar eklenmez", async () => {
    const result = await runProvider(deps(fakeFetcher()), "rss_news", { force: true });
    expect(result.itemsFetched).toBe(0);
    const [{ n }] = (await db.select({ n: count() }).from(sourceItems)) as [{ n: number }];
    expect(n).toBe(((await publisherCount()) - 2) * 3);
  });

  it("Google Trends: sinyaller kaydedilir; hata ardışık hata sayısını artırır", async () => {
    const ok = await runProvider(deps(fakeFetcher()), "google_trends", { force: true });
    expect(ok.status).toBe("success");
    expect(ok.itemsFetched).toBe(2);
    const signals = await db.select().from(trendSignals);
    expect(signals.map((s) => s.term).sort()).toEqual(["deprem", "derbi"]);
    expect(signals.find((s) => s.term === "deprem")?.related).toHaveLength(1);

    const bad = await runProvider(deps(fakeFetcher({ failTrends: true })), "google_trends", {
      force: true,
    });
    expect(bad.status).toBe("failed");
    expect(bad.errorCode).toBe("timeout");
    const [provider] = await db
      .select()
      .from(dataProviders)
      .where(eq(dataProviders.key, "google_trends"));
    expect(provider?.consecutiveFailures).toBe(1);
  });

  it("API veri kaynağı durumu gerçek durumu gösterir (hata ayrıntısı olmadan)", async () => {
    await db
      .update(dataProviders)
      .set({ isEnabled: true })
      .where(eq(dataProviders.key, "google_trends"));
    const app = await buildApp({
      repo: createTopicRepository(db),
      cacheTtlSeconds: 0,
      rateLimitMax: 1000,
      logLevel: "silent",
    });
    const res = await app.inject("/api/v1/meta/status");
    const body = StatusResponseSchema.parse(res.json());
    expect(body.providers.find((p) => p.key === "google_trends")?.state).toBe("error");
    expect(body.providers.find((p) => p.key === "rss_news")?.state).toBe("not_connected");
    expect(res.body).not.toContain("timeout");
    await app.close();
  });

  it("zamanlayıcı yalnızca açık ve zamanı gelmiş sağlayıcıyı çalıştırır", async () => {
    const before = (await db.select({ n: count() }).from(fetchRuns))[0]!.n;
    // google_trends az önce çalıştı ve hata verdi → bekleme süresi dolmadı
    const fetcher = fakeFetcher();
    await tick(deps(fetcher));
    expect(fetcher.calls).toHaveLength(0);
    // 2 saat sonra zamanı gelir
    const later = new Date(Date.now() + 2 * 3_600_000);
    await tick(deps(fetcher, () => later));
    expect(fetcher.calls).toEqual(["https://trends.google.com/trending/rss?geo=TR"]);
    const after = (await db.select({ n: count() }).from(fetchRuns))[0]!.n;
    expect(after).toBe(before + 1);
  });

  it("aynı sağlayıcı aynı anda iki kez çalışmaz (kilit)", async () => {
    const slow = fakeFetcher({ delayMs: 300 });
    const [a, b] = await Promise.all([
      runProvider(deps(slow), "google_trends", { force: true }),
      runProvider(deps(slow), "google_trends", { force: true }),
    ]);
    expect([a.skipped, b.skipped].filter((s) => s === "locked")).toHaveLength(1);
  });
});
