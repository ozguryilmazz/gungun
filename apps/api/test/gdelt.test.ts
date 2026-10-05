import { describe, expect, it } from "vitest";
import { FeedParseError } from "../src/ingest/feed-parser.ts";
import {
  gdeltSearchUrl,
  parseGdelt,
  parseSeenDate,
  sourceName,
} from "../src/ingest/providers/gdelt-news.ts";
import { SafeFetchError } from "../src/lib/safe-http.ts";

const known = new Map([["hurriyet.com.tr", "Hürriyet"]]);

describe("GDELT", () => {
  it("arama adresi: Türkçe kaynaklar, son 1 gün, çok kelimeli terim tırnaklı", () => {
    const u = new URL(gdeltSearchUrl("ali koç"));
    expect(u.hostname).toBe("api.gdeltproject.org");
    expect(u.searchParams.get("query")).toBe('"ali koç" sourcelang:turkish');
    expect(u.searchParams.get("timespan")).toBe("1d");
    expect(u.searchParams.get("format")).toBe("json");
    expect(new URL(gdeltSearchUrl("togg")).searchParams.get("query")).toBe(
      "togg sourcelang:turkish",
    );
  });

  it("yanıt: geçerli haberler alınır; kaynak adı bilinen yayıncıdan, değilse alan adı", () => {
    const body = Buffer.from(
      JSON.stringify({
        articles: [
          {
            url: "https://www.hurriyet.com.tr/ekonomi/togg-1",
            title: "Togg'dan yeni kampanya",
            seendate: "20261005T081500Z",
            domain: "hurriyet.com.tr",
          },
          {
            url: "https://www.yerelhaber.example/a",
            title: "Togg bayisi açıldı",
            domain: "www.yerelhaber.example",
          },
          { url: "javascript:alert(1)", title: "Kötü bağlantı" },
          { title: "Bağlantısız" },
        ],
      }),
    );
    const items = parseGdelt(body, known);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      source: "Hürriyet",
      publishedAt: new Date("2026-10-05T08:15:00Z"),
    });
    expect(items[1]?.source).toBe("yerelhaber.example");
  });

  it("boş sonuç {} geçerlidir", () => {
    expect(parseGdelt(Buffer.from("{}"), known)).toEqual([]);
  });

  it("düz metin sınır uyarısı 429 sayılır; diğer düz metin ayrıştırma hatası", () => {
    expect(() =>
      parseGdelt(Buffer.from("Please limit requests to one every 5 seconds."), known),
    ).toThrow(SafeFetchError);
    expect(() => parseGdelt(Buffer.from("The specified phrase is too short."), known)).toThrow(
      FeedParseError,
    );
  });

  it("tarih ve kaynak adı yardımcıları", () => {
    expect(parseSeenDate("bozuk")).toBeNull();
    expect(sourceName("m.hurriyet.com.tr", known)).toBe("Hürriyet");
    expect(sourceName(undefined, known)).toBeNull();
  });
});
