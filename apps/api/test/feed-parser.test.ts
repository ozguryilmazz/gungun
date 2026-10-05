import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FeedParseError, parseFeed, parseTrends } from "../src/ingest/feed-parser.ts";
import {
  cleanText,
  hostBelongsTo,
  normalizeUrl,
  parseApproxTraffic,
  parseDate,
} from "../src/ingest/normalize.ts";

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url));
const NOW = new Date("2026-10-05T12:00:00Z");

describe("parseFeed — RSS 2.0", () => {
  const items = parseFeed(fixture("rss2.xml"), "application/rss+xml; charset=utf-8", NOW);

  it("başlıktan HTML ve CDATA temizlenir, varlıklar çözülür", () => {
    expect(items[0]?.title).toBe("İstanbul'da yoğun kar yağışı & ulaşım");
  });

  it("izleme parametreleri ve # kaldırılır", () => {
    expect(items[0]?.url).toBe("https://www.ornekhaber.com.tr/gundem/kar-yagisi-123");
  });

  it("tarih çözülür; geçersiz tarih null olur", () => {
    expect(items[0]?.publishedAt?.toISOString()).toBe("2026-10-05T05:15:00.000Z");
    expect(items[1]?.publishedAt).toBeNull();
  });

  it("javascript: bağlantılı ve başlıksız öğeler atlanır; açıklama alınmaz", () => {
    expect(items.map((i) => i.url)).not.toContain("javascript:alert(document.cookie)");
    expect(items.some((i) => i.title === "")).toBe(false);
    expect(JSON.stringify(items)).not.toContain("SAKLANMAMALI");
    // Başka alan adındaki bağlantı ayrıştırıcıda kalır; alan adı filtresi sağlayıcıda uygulanır
    expect(items).toHaveLength(3);
  });
});

describe("parseFeed — diğer biçimler", () => {
  it("RSS 1.0 (RDF) ve dc:date", () => {
    const [item] = parseFeed(fixture("rdf.xml"), "", NOW);
    expect(item).toEqual({
      title: "RDF biçiminde haber",
      url: "https://www.ornekhaber.com.tr/tr/rdf-haber/a-1",
      publishedAt: new Date("2026-10-05T06:00:00Z"),
      source: null,
    });
  });

  it("RSS <source> öğesi (Google Haberler) kaynak adı olarak alınır", () => {
    const xml = Buffer.from(
      '<rss><channel><item><title>Başlık - Hürriyet</title><link>https://news.google.com/rss/articles/abc?oc=5</link><source url="https://www.hurriyet.com.tr">Hürriyet</source></item></channel></rss>',
    );
    expect(parseFeed(xml, "", NOW)[0]?.source).toBe("Hürriyet");
  });

  it("Atom: alternate bağlantı seçilir, kaçışlı HTML düz metne iner", () => {
    const [item] = parseFeed(fixture("atom.xml"), "", NOW);
    expect(item?.url).toBe("https://www.ornekhaber.com.tr/atom-haber");
    expect(item?.title).toBe("Atom haberi");
  });

  it("windows-1254 kodlamalı Türkçe feed doğru okunur", () => {
    const [item] = parseFeed(fixture("win1254.xml"), "text/xml", NOW);
    expect(item?.title).toBe("Şırnak'ta ığdır haberi: ÇÖĞÜŞİ");
  });

  it("DTD/ENTITY içeren belge (XXE, billion laughs) reddedilir", () => {
    expect(() => parseFeed(fixture("xxe.xml"), "", NOW)).toThrow(FeedParseError);
  });

  it("feed olmayan içerik reddedilir", () => {
    expect(() => parseFeed(Buffer.from("<html><body>hi</body></html>"), "", NOW)).toThrow(
      FeedParseError,
    );
    expect(() => parseFeed(Buffer.from("not xml at all <<<"), "", NOW)).toThrow(FeedParseError);
  });
});

describe("parseTrends", () => {
  it("terim, yaklaşık trafik ve güvenli ilgili haberler", () => {
    const trends = parseTrends(fixture("trends.xml"), "", NOW);
    expect(trends.map((t) => [t.term, t.approxTraffic])).toEqual([
      ["deprem", 50000],
      ["derbi", 20000],
    ]);
    expect(trends[0]?.related).toEqual([
      {
        title: "Bir ilde deprem meydana geldi",
        url: "https://www.ornekhaber.com.tr/deprem",
        source: "Örnek Haber",
      },
    ]);
  });
});

describe("normalize", () => {
  it("cleanText uzunluğu sınırlar ve kontrol karakterlerini atar", () => {
    // Metin yönünü çeviren görünmez karakterler (sahte başlık) temizlenir
    expect(cleanText("a\u0000b\u202Ec\u2066d")).toBe("a b c d");
    expect(cleanText("x".repeat(400)).length).toBe(300);
    expect(cleanText(42)).toBe("");
  });

  it("normalizeUrl yalnızca http(s), kimlik bilgisiz", () => {
    expect(normalizeUrl("data:text/html,x")).toBeNull();
    expect(normalizeUrl("https://user:pw@site.com/")).toBeNull();
    expect(normalizeUrl("HTTPS://WWW.Site.COM/A?b=1&utm_campaign=x&fbclid=y")).toBe(
      "https://www.site.com/A?b=1",
    );
  });

  it("hostBelongsTo alt alan adı ve benzeri isimleri ayırt eder", () => {
    expect(hostBelongsTo("www.ntv.com.tr", "ntv.com.tr")).toBe(true);
    expect(hostBelongsTo("ntv.com.tr", "ntv.com.tr")).toBe(true);
    expect(hostBelongsTo("kotuntv.com.tr", "ntv.com.tr")).toBe(false);
    expect(hostBelongsTo("ntv.com.tr.kotu.example", "ntv.com.tr")).toBe(false);
  });

  it("parseDate gelecek ve çok eski tarihleri reddeder", () => {
    expect(parseDate("2030-01-01T00:00:00Z", NOW)).toBeNull();
    expect(parseDate("1990-01-01T00:00:00Z", NOW)).toBeNull();
  });

  it("parseApproxTraffic", () => {
    expect(parseApproxTraffic("2.000+")).toBe(2000);
    expect(parseApproxTraffic("yok")).toBeNull();
  });
});

describe("parseFeed — bağlantı biçimleri", () => {
  const xml = (items: string) =>
    Buffer.from(`<?xml version="1.0"?><rss version="2.0"><channel>${items}</channel></rss>`);
  const base = "https://www.ornekhaber.com.tr/rss/sondakika.xml";

  it("göreli bağlantı feed adresine göre çözülür", () => {
    const [item] = parseFeed(
      xml("<item><title>A</title><link>/gundem/a-1</link></item>"),
      "",
      NOW,
      base,
    );
    expect(item?.url).toBe("https://www.ornekhaber.com.tr/gundem/a-1");
  });

  it("sayısal guid bağlantı sayılmaz; mutlak guid kullanılır", () => {
    const items = parseFeed(
      xml(
        "<item><title>A</title><guid>7673337</guid></item>" +
          '<item><title>B</title><guid isPermaLink="true">https://www.ornekhaber.com.tr/b</guid></item>',
      ),
      "",
      NOW,
      base,
    );
    expect(items.map((i) => i.url)).toEqual(["https://www.ornekhaber.com.tr/b"]);
  });

  it("atom:link href özniteliği ve protokolsüz (//) adres", () => {
    const items = parseFeed(
      xml(
        '<item><title>A</title><atom:link xmlns:atom="http://www.w3.org/2005/Atom" href="https://www.ornekhaber.com.tr/c"/></item>' +
          "<item><title>B</title><link>//kotu.example/x</link></item>",
      ),
      "",
      NOW,
      base,
    );
    expect(items.map((i) => i.url)).toEqual(["https://www.ornekhaber.com.tr/c"]);
  });
});
