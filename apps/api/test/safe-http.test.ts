import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { gzipSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isPublicAddress } from "../src/lib/ip.ts";
import { SafeFetchError, safeFetch, type FetchPolicy } from "../src/lib/safe-http.ts";

const UA = "test-bot";

describe("isPublicAddress", () => {
  it.each([
    "127.0.0.1",
    "10.1.2.3",
    "172.16.0.1",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "::1",
    "fe80::1",
    "fd00::1",
    "::ffff:127.0.0.1",
    "::ffff:10.0.0.1",
    "224.0.0.1",
    "not-an-ip",
  ])("iç/ayrılmış adres: %s", (ip) => expect(isPublicAddress(ip)).toBe(false));
  it.each(["8.8.8.8", "185.10.10.10", "2606:4700::1111"])("public adres: %s", (ip) =>
    expect(isPublicAddress(ip)).toBe(true),
  );
});

describe("safeFetch — varsayılan (üretim) politika", () => {
  const policy: FetchPolicy = { isHostAllowed: (h) => h === "example.org", userAgent: UA };
  const blocked = async (url: string, code: string, p: FetchPolicy = policy) => {
    await expect(safeFetch(url, p)).rejects.toMatchObject({ code });
  };

  it("http, standart dışı port ve kimlik bilgisi reddedilir", async () => {
    await blocked("http://example.org/feed", "blocked_url");
    await blocked("https://example.org:8443/feed", "blocked_url");
    await blocked("https://u:p@example.org/feed", "blocked_url");
    await blocked("file:///etc/passwd", "blocked_url");
    await blocked("gopher://example.org/", "blocked_url");
  });

  it("izin listesi dışındaki host ve iç ağ adresleri reddedilir", async () => {
    await blocked("https://evil.example/feed", "blocked_host");
    await blocked("https://localhost/feed", "blocked_host", {
      ...policy,
      isHostAllowed: () => true,
    });
    await blocked("https://127.0.0.1/feed", "blocked_address", {
      ...policy,
      isHostAllowed: () => true,
    });
    await blocked("https://169.254.169.254/latest/meta-data", "blocked_address", {
      ...policy,
      isHostAllowed: () => true,
    });
    await blocked("https://[::1]/feed", "blocked_address", {
      ...policy,
      isHostAllowed: () => true,
    });
  });
});

describe("safeFetch — yerel test sunucusu ile davranış", () => {
  let server: Server;
  let base: string;
  const bomb = gzipSync(Buffer.alloc(10 * 1024 * 1024, 0x61));

  beforeAll(async () => {
    server = createServer((req, res) => {
      const url = req.url ?? "/";
      if (url === "/ok") return res.writeHead(200, { "content-type": "text/xml" }).end("<rss/>");
      if (url === "/gzip")
        return res.writeHead(200, { "content-encoding": "gzip" }).end(gzipSync("<rss>gz</rss>"));
      if (url === "/bomb") return res.writeHead(200, { "content-encoding": "gzip" }).end(bomb);
      if (url === "/big")
        return res
          .writeHead(200, { "content-length": String(5 * 1024 * 1024) })
          .end(Buffer.alloc(5 * 1024 * 1024));
      if (url === "/stream-big") {
        res.writeHead(200);
        for (let i = 0; i < 50; i++) res.write(Buffer.alloc(100 * 1024));
        return res.end();
      }
      if (url === "/redirect-same") return res.writeHead(302, { location: "/ok" }).end();
      if (url === "/redirect-evil")
        return res.writeHead(302, { location: "http://evil.example/x" }).end();
      if (url === "/loop") return res.writeHead(302, { location: "/loop" }).end();
      if (url === "/slow") return setTimeout(() => res.end("geç"), 2000);
      if (url === "/500") return res.writeHead(500).end("boom");
      return res.writeHead(404).end();
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  // YALNIZCA testte: yerel sunucuya (127.0.0.1 + rastgele port) izin verilir
  const local = (over: Partial<FetchPolicy> = {}): FetchPolicy => ({
    isHostAllowed: (h) => h === "127.0.0.1",
    protocols: ["http:"],
    allowPrivateAddresses: true,
    userAgent: UA,
    timeoutMs: 1000,
    maxBytes: 1024 * 1024,
    ...over,
  });

  it("başarılı istek ve gzip açma", async () => {
    expect((await safeFetch(`${base}/ok`, local())).body.toString()).toBe("<rss/>");
    expect((await safeFetch(`${base}/gzip`, local())).body.toString()).toBe("<rss>gz</rss>");
  });

  it("izinli yönlendirme izlenir, izin dışı hedefe yönlendirme engellenir", async () => {
    expect((await safeFetch(`${base}/redirect-same`, local())).finalUrl).toBe(`${base}/ok`);
    await expect(safeFetch(`${base}/redirect-evil`, local())).rejects.toMatchObject({
      code: "blocked_host",
    });
    await expect(safeFetch(`${base}/loop`, local())).rejects.toMatchObject({
      code: "too_many_redirects",
    });
  });

  it("boyut sınırı: bildirilen, akan ve sıkıştırma bombası", async () => {
    for (const path of ["/big", "/stream-big", "/bomb"]) {
      await expect(safeFetch(`${base}${path}`, local())).rejects.toMatchObject({
        code: "too_large",
      });
    }
  });

  it("zaman aşımı ve HTTP hatası", async () => {
    await expect(safeFetch(`${base}/slow`, local({ timeoutMs: 200 }))).rejects.toMatchObject({
      code: "timeout",
    });
    await expect(safeFetch(`${base}/500`, local())).rejects.toMatchObject({
      code: "http_error",
      status: 500,
    });
  });

  it("test modu kapalıyken yerel sunucuya bağlanılamaz", async () => {
    await expect(
      safeFetch(`${base}/ok`, { ...local(), allowPrivateAddresses: false }),
    ).rejects.toBeInstanceOf(SafeFetchError);
  });
});
