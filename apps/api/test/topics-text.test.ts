import { describe, expect, it } from "vitest";
import { categoryFromUrl, inferCategory } from "../src/topics-pipeline/category.ts";
import {
  clusterItems,
  distinctPublishers,
  representative,
  type ClusterInput,
} from "../src/topics-pipeline/cluster.ts";
import { calmTitle, slugify, tokenize } from "../src/topics-pipeline/text.ts";

describe("tokenize", () => {
  it("Türkçe ekleri ve durak kelimeleri ayıklar", () => {
    expect(
      tokenize("SON DAKİKA: İsrail'in yasadışı yerleşim faaliyetlerine AB'den tepki!"),
    ).toEqual(["israil", "yasadı", "yerleş", "faaliy", "tepk"]);
  });

  it("aynı kökün farklı ekleri eşleşir", () => {
    expect(tokenize("Depremde yıkılan binalar")[0]).toBe(tokenize("Deprem bölgesi")[0]);
    const same = (a: string, b: string) => expect(tokenize(a)).toEqual(tokenize(b));
    same("faiz", "faizini");
    same("kararı", "kararına");
    same("derbide", "derbisi");
    same("kazası", "kazasında");
    same("tepki", "tepkisiyle");
  });
});

describe("calmTitle", () => {
  it("bağıran önekleri ve ünlemleri yumuşatır, anlamı değiştirmez", () => {
    expect(calmTitle("SON DAKİKA: Merkez Bankası faiz kararını açıkladı!!!")).toBe(
      "Merkez Bankası faiz kararını açıkladı",
    );
    expect(calmTitle("ŞOK! İSTANBUL'DA BÜYÜK YANGIN")).toBe("İstanbul'da büyük yangın");
    expect(calmTitle("Normal başlık")).toBe("Normal başlık");
  });
});

describe("slugify", () => {
  it("Türkçe karakterler ve uzunluk", () => {
    expect(slugify("İsrail–ABD gerilimi: Şırnak'ta ığdır")).toBe(
      "israil-abd-gerilimi-sirnak-ta-igdir",
    );
    expect(slugify("çok ".repeat(40)).length).toBeLessThanOrEqual(80);
    expect(slugify("!!!")).toBe("konu");
  });
});

describe("kategori", () => {
  it("adres bölümünden kategori", () => {
    expect(categoryFromUrl("https://www.milliyet.com.tr/dunya/son-dakika-x-1")).toBe("dunya");
    expect(categoryFromUrl("https://www.ntv.com.tr/ekonomi/faiz")).toBe("ekonomi");
    expect(categoryFromUrl("https://www.aa.com.tr/tr/spor/derbi")).toBe("spor");
    expect(categoryFromUrl("https://www.x.com/haber-123")).toBeNull();
  });

  it("çoğunluk oyu, belirsizse diğer", () => {
    expect(
      inferCategory(["https://a.com/spor/1", "https://b.com/spor/2", "https://c.com/gundem/3"]),
    ).toBe("spor");
    expect(inferCategory(["https://a.com/x"])).toBe("diger");
  });
});

describe("clusterItems", () => {
  let id = 0;
  const item = (
    title: string,
    publisherId: number,
    minutesAgo = 0,
    topicId: string | null = null,
  ): ClusterInput => ({
    id: ++id,
    title,
    url: `https://site${publisherId}.example/gundem/${id}`,
    publisherId,
    at: new Date(Date.UTC(2026, 9, 5, 12) - minutesAgo * 60_000),
    topicId,
  });

  it("aynı olayı anlatan farklı yayıncı başlıkları tek konuda, farklı olaylar ayrı", () => {
    const items = [
      item("Merkez Bankası politika faizini yüzde 40'ta sabit tuttu", 1, 60),
      item("SON DAKİKA: Merkez Bankası faiz kararını açıkladı: politika faizi sabit", 2, 50),
      item("Merkez Bankası faizi sabit bıraktı", 3, 40),
      item("Fenerbahçe derbide Galatasaray'ı 2-1 yendi", 1, 30),
      item("Derbide kazanan Fenerbahçe: Galatasaray 1-2 Fenerbahçe", 4, 20),
      item("İstanbul'da kar yağışı ulaşımı aksattı", 5, 10),
    ];
    const clusters = clusterItems(items);
    const sizes = clusters.map((c) => c.items.length).sort((a, b) => b - a);
    expect(sizes).toEqual([3, 2, 1]);
    const faiz = clusters.find((c) => c.items.length === 3)!;
    expect(distinctPublishers(faiz.items)).toBe(3);
    expect(representative(faiz).title).toContain("Merkez Bankası");
  });

  it("yalnızca genel ifadeyi paylaşan farklı haberler birleşmez", () => {
    const items = [
      item("Merkez Bankası politika faizini sabit tuttu", 1),
      item("Merkez Bankası rezervleri geçen hafta arttı", 2),
      item("Merkez Bankası başkanı Londra'da yatırımcılarla görüştü", 3),
      item("Merkez Bankası faiz kararını açıkladı", 4),
    ];
    const sizes = clusterItems(items)
      .map((c) => c.items.length)
      .sort((a, b) => b - a);
    expect(sizes).toEqual([2, 1, 1]);
  });

  it("zincirleme birleşme olmaz (yalnızca ortak genel kelime yetmez)", () => {
    const items = [
      item("Ankara'da trafik kazası: 3 yaralı", 1),
      item("Ankara'da konser iptal edildi", 2),
      item("Ankara'da hava durumu yarın yağmurlu", 3),
    ];
    expect(clusterItems(items)).toHaveLength(3);
  });

  it("mevcut konuya bağlı haberler kümesini korur, yeni benzer haber ona katılır", () => {
    const items = [
      item("Merkez Bankası politika faizini sabit tuttu", 1, 60, "topic-1"),
      item("Merkez Bankası faiz kararı: politika faizi sabit", 2, 50, "topic-1"),
      item("Merkez Bankası politika faizi kararı sonrası piyasalar", 3, 5),
    ];
    const clusters = clusterItems(items);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]?.topicId).toBe("topic-1");
    expect(clusters[0]?.items).toHaveLength(3);
  });
});
