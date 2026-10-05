import {
  CategoryListResponseSchema,
  ErrorResponseSchema,
  StatusResponseSchema,
  TopicDetailResponseSchema,
  TopicHistoryResponseSchema,
  TopicListResponseSchema,
} from "@gundemci/shared";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.ts";
import { NOW, fakeRepo, type FakeRepo } from "./helpers.ts";

let app: FastifyInstance | undefined;

async function setup(
  repo: FakeRepo = fakeRepo(),
  extra: { rateLimitMax?: number; cacheTtlSeconds?: number } = {},
) {
  app = await buildApp({
    repo,
    cacheTtlSeconds: extra.cacheTtlSeconds ?? 30,
    rateLimitMax: extra.rateLimitMax ?? 1000,
    logLevel: "silent",
    clock: () => NOW,
  });
  return { app, repo };
}

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe("GET /api/v1/topics", () => {
  it("sözleşmeye uygun liste döner, örnek veri işaretli", async () => {
    const { app } = await setup();
    const res = await app.inject("/api/v1/topics");
    expect(res.statusCode).toBe(200);
    const body = TopicListResponseSchema.parse(res.json());
    expect(body.items).toHaveLength(4);
    expect(body.meta.isMock).toBe(true);
    expect(res.headers["cache-control"]).toContain("max-age=30");
  });

  it("kategori filtresi ve limit", async () => {
    const { app } = await setup();
    const bilim = TopicListResponseSchema.parse(
      (await app.inject("/api/v1/topics?category=bilim")).json(),
    );
    expect(bilim.items.map((t) => t.slug)).toEqual(["ornek-az-kaynakli"]);
    // Sıra numarası global sıralamadan gelir
    expect(bilim.items[0]!.rank).toBe(2);
    const limited = TopicListResponseSchema.parse(
      (await app.inject("/api/v1/topics?limit=1")).json(),
    );
    expect(limited.items).toHaveLength(1);
  });

  it("bilinmeyen kategori 404", async () => {
    const { app } = await setup();
    const res = await app.inject("/api/v1/topics?category=olmayan");
    expect(res.statusCode).toBe(404);
    expect(ErrorResponseSchema.parse(res.json()).error.code).toBe("not_found");
  });

  it.each([
    "/api/v1/topics?limit=0",
    "/api/v1/topics?limit=51",
    "/api/v1/topics?limit=abc",
    "/api/v1/topics?category=EKONOMI",
    "/api/v1/topics?category=eko%27%3Bdrop%20table%20topics--",
    "/api/v1/topics?bilinmeyen=1",
    "/api/v1/topics/rising?limit=-1",
  ])("geçersiz sorgu 400: %s", async (url) => {
    const { app, repo } = await setup();
    const res = await app.inject(url);
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: { code: "invalid_request", message: "Geçersiz istek." } });
    expect(repo.calls.list ?? 0).toBe(0);
  });

  it("aynı liste önbellekten gelir (veritabanına tek sorgu)", async () => {
    const { app, repo } = await setup();
    await app.inject("/api/v1/topics");
    await app.inject("/api/v1/topics/rising");
    await app.inject("/api/v1/topics/falling");
    expect(repo.calls.list).toBe(1);
  });
});

describe("yükselenler / düşenler", () => {
  it("yükselenler trend konularından; haber listesi ayrı", async () => {
    const { app: a } = await setup();
    const news = TopicListResponseSchema.parse((await a.inject("/api/v1/topics?kind=news")).json());
    expect(news.items.map((t) => [t.slug, t.kind, t.rank])).toEqual([
      ["ornek-haber-az-kaynakli", "news", 1],
    ]);
    expect((await a.inject("/api/v1/topics?kind=x")).statusCode).toBe(400);
  });

  it("az kaynaklı trend konusu da yükselenlerde (arama sinyali yeterli)", async () => {
    const { app } = await setup();
    const rising = TopicListResponseSchema.parse(
      (await app.inject("/api/v1/topics/rising")).json(),
    );
    expect(rising.items.map((t) => t.slug)).toEqual(["ornek-az-kaynakli", "ornek-yukselen"]);
    const falling = TopicListResponseSchema.parse(
      (await app.inject("/api/v1/topics/falling")).json(),
    );
    expect(falling.items.map((t) => t.slug)).toEqual(["ornek-dusen"]);
  });
});

describe("GET /api/v1/topics/:slug", () => {
  it("detay: eksik sinyal, bilinmeyen zaman çizelgesi türü ve zararlı link süzülür", async () => {
    const { app } = await setup();
    const res = await app.inject("/api/v1/topics/ornek-yukselen");
    expect(res.statusCode).toBe(200);
    const { item } = TopicDetailResponseSchema.parse(res.json());
    expect(item.rank).toBe(1);
    expect(item.components.find((c) => c.key === "search_interest")).toEqual(
      expect.objectContaining({ available: false, value: null }),
    );
    expect(item.components.find((c) => c.key === "news_visibility")?.value).toBe(90);
    expect(item.timeline.map((e) => e.type)).toEqual(["first_source"]);
    expect(item.sources.map((s) => s.url)).toEqual(["https://example.org/1"]);
  });

  it("bilinmeyen konu 404", async () => {
    const { app } = await setup();
    expect((await app.inject("/api/v1/topics/olmayan-konu")).statusCode).toBe(404);
  });

  it.each(["..%2F..%2Fetc%2Fpasswd", "Buyuk-Harf", "a--b", "%3Cscript%3E", "x".repeat(200)])(
    "geçersiz slug veritabanına ulaşmadan 404: %s",
    async (slug) => {
      const { app, repo } = await setup();
      const res = await app.inject(`/api/v1/topics/${slug}`);
      expect(res.statusCode).toBe(404);
      expect(repo.calls.detail ?? 0).toBe(0);
    },
  );

  it("skor geçmişi", async () => {
    const { app } = await setup();
    const res = await app.inject("/api/v1/topics/ornek-yukselen/history");
    expect(res.statusCode).toBe(200);
    const body = TopicHistoryResponseSchema.parse(res.json());
    expect(body.items.map((i) => i.score)).toEqual([55, 92]);
  });
});

describe("meta", () => {
  it("kategoriler", async () => {
    const { app } = await setup();
    const body = CategoryListResponseSchema.parse((await app.inject("/api/v1/categories")).json());
    expect(body.items).toHaveLength(12);
    expect(body.items[0]).toEqual({ slug: "turkiye", name: "Türkiye" });
  });

  it("veri kaynağı durumu: manuel/seed gizli, hata ayrıntısı yok", async () => {
    const { app } = await setup();
    const res = await app.inject("/api/v1/meta/status");
    const body = StatusResponseSchema.parse(res.json());
    expect(body.providers.map((p) => [p.key, p.state])).toEqual([
      ["google_trends", "not_connected"],
      ["rss_news", "ok"],
    ]);
    expect(res.body).not.toContain("config");
  });

  it("kök adres yol gösterir, teknik ayrıntı vermez", async () => {
    const { app } = await setup();
    const res = await app.inject("/");
    expect(res.statusCode).toBe(200);
    expect(res.json().message).toContain("localhost:3000");
    expect(res.body).not.toMatch(/fastify|node|version|postgres/i);
  });

  it("health ve ready", async () => {
    const repo = fakeRepo();
    const { app } = await setup(repo);
    expect((await app.inject("/health")).json()).toEqual({ status: "ok" });
    expect((await app.inject("/health/ready")).statusCode).toBe(200);
    repo.pingFails = true;
    const res = await app.inject("/health/ready");
    expect(res.statusCode).toBe(503);
    // Veritabanı adresi / şifre gibi iç ayrıntılar sızmaz
    expect(res.body).not.toMatch(/ECONNREFUSED|10\.0\.0\.5|password|gizli/);
  });
});

describe("hata yönetimi ve güvenlik", () => {
  it("beklenmeyen hata: genel Türkçe mesaj, teknik ayrıntı yok", async () => {
    const repo = fakeRepo();
    repo.failWith = new Error('relation "topics" does not exist at /srv/app/secret.ts:12');
    const { app } = await setup(repo);
    const res = await app.inject("/api/v1/topics");
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({
      error: { code: "internal_error", message: "Bu veri şu anda güncellenemiyor." },
    });
    expect(res.body).not.toMatch(/relation|secret|stack|\.ts/);
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  it("tanımsız rota ve yazma metotları 404", async () => {
    const { app } = await setup();
    expect((await app.inject("/api/v1/yok")).statusCode).toBe(404);
    expect(
      (await app.inject({ method: "POST", url: "/api/v1/topics", payload: { a: 1 } })).statusCode,
    ).toBe(404);
    expect(
      (await app.inject({ method: "DELETE", url: "/api/v1/topics/ornek-yukselen" })).statusCode,
    ).toBe(404);
  });

  it("güvenlik başlıkları var, CORS ve x-powered-by yok", async () => {
    const { app } = await setup();
    const res = await app.inject({
      url: "/api/v1/topics",
      headers: { origin: "https://kotu-site.example" },
    });
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["content-security-policy"]).toContain("default-src 'none'");
    expect(res.headers["x-frame-options"]).toBeDefined();
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
    expect(res.headers["x-powered-by"]).toBeUndefined();
  });

  it("istek kimliği sunucuda üretilir, dışarıdan gelen kabul edilmez", async () => {
    const { app } = await setup();
    const res = await app.inject({
      url: "/health",
      headers: { "x-request-id": "sahte\nlog-satiri" },
    });
    expect(res.headers["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("rate limit aşılınca 429 ve Türkçe mesaj", async () => {
    const { app } = await setup(fakeRepo(), { rateLimitMax: 2 });
    await app.inject("/api/v1/categories");
    await app.inject("/api/v1/categories");
    const res = await app.inject("/api/v1/categories");
    expect(res.statusCode).toBe(429);
    expect(res.json().error).toEqual({
      code: "rate_limited",
      message: "Çok fazla istek gönderildi. Lütfen biraz sonra tekrar deneyin.",
    });
  });
});
