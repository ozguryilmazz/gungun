import { describe, expect, it } from "vitest";
import { categoryFromUrl, inferCategory } from "../src/topics-pipeline/category.ts";
import {
  clusterItems,
  distinctPublishers,
  representative,
  type ClusterInput,
} from "../src/topics-pipeline/cluster.ts";
import { matchTrend } from "../src/topics-pipeline/pipeline.ts";
import { calmTitle, isMediaTerm, slugify, tokenize } from "../src/topics-pipeline/text.ts";

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

describe("matchTrend", () => {
  const cluster = (titles: string[]) => ({
    topicId: null,
    tokenCounts: new Map<string, number>(),
    items: titles.map((title, i) => ({
      id: i,
      title,
      url: "https://x.com/a",
      publisherId: i,
      at: new Date(),
      topicId: null,
    })),
  });
  const trend = (term: string) => ({ term, tokens: tokenize(term), approxTraffic: 10000 });

  it("medya adı araması (Sözcü) 'parti sözcüsü' haberiyle eşleşmez", () => {
    const c = cluster(["AK Parti Sözcüsü Çelik'ten tepki", "AK Parti Sözcüsü açıklama yaptı"]);
    expect(isMediaTerm("Sözcü")).toBe(true);
    expect(matchTrend(c, [trend("sözcü")])).toBeNull();
  });

  it("tek kelimelik terim: kendisi ve hal ekli hâli eşleşir, iyelik/türetilmiş hâli eşleşmez", () => {
    expect(
      matchTrend(cluster(["Derbide gergin anlar", "Fenerbahçe derbiden galip çıktı"]), [
        trend("derbi"),
      ])?.term,
    ).toBe("derbi");
    expect(
      matchTrend(cluster(["Parti sözcüsü açıklama yaptı", "Sözcüsü konuştu"]), [trend("sözcüler")]),
    ).toBeNull();
    const c = cluster(["Malatya'da deprem meydana geldi", "Deprem sonrası açıklama"]);
    expect(matchTrend(c, [trend("deprem")])?.term).toBe("deprem");
    const yasak = cluster(["Gözlükler yasaklanıyor", "Yasaklanan gözlükler"]);
    expect(matchTrend(yasak, [trend("yasak")])).toBeNull();
  });

  it("çok kelimeli terim kök eşleşmesiyle bulunur", () => {
    const c = cluster([
      "Fenerbahçe Galatasaray derbisinde gergin anlar",
      "Derbide Fenerbahçe kazandı",
    ]);
    expect(matchTrend(c, [trend("fenerbahçe galatasaray")])?.term).toBe("fenerbahçe galatasaray");
  });
});

describe("trend başlığı ve kart başlığı", () => {
  it("terimin yazımı haber başlıklarından öğrenilir", async () => {
    const { displayTerm } = await import("../src/topics-pipeline/pipeline.ts");
    expect(
      displayTerm("aöf", ["AÖF KAYIT YENİLEME EKRANI 2026", "AÖF sınav sonuçları açıklandı"]),
    ).toBe("AÖF");
    expect(displayTerm("trendyol", ["Trendyol'dan yeni kampanya"])).toBe("Trendyol");
    expect(displayTerm("ali koç", [])).toBe("Ali Koç");
  });

  it("trend kartında yalnızca terimi içeren haber başlığı gösterilir", async () => {
    const { pickHeadline } = await import("../src/modules/topics/repository.ts");
    const candidates = [
      {
        title: "TEKNOFEST Şanlıurfa'da güvenlik ASELSAN'a emanet edildi",
        source: "TRT Haber",
        url: "https://a.example/1",
      },
      { title: "Trendyol'dan indirim açıklaması", source: "NTV", url: "https://a.example/2" },
    ];
    expect(pickHeadline(candidates, "trendyol")?.source).toBe("NTV");
    expect(pickHeadline(candidates.slice(0, 1), "trendyol")).toBeNull();
    expect(pickHeadline(candidates, null)?.source).toBe("TRT Haber");
  });
});

describe("başlık aramayı açıklıyor mu (dil ve tam eşleşme)", () => {
  it("çok kelimeli aramada her kelime gerekir; sayılar birebir", async () => {
    const { titleMentionsTerm } = await import("../src/topics-pipeline/pipeline.ts");
    expect(
      titleMentionsTerm("Ege'de 1 Ekim'de sağanak ve fırtınaya dikkat", "6 ekim ne günü"),
    ).toBe(false);
    expect(titleMentionsTerm("Motorine büyük indirim geldi", "motorine indirim")).toBe(true);
    expect(titleMentionsTerm("Arda Güler'in golü maça damga vurdu", "arda güler")).toBe(true);
    expect(
      titleMentionsTerm("Derbi özeti: Fenerbahçe 2-1 Galatasaray", "fenerbahçe galatasaray"),
    ).toBe(true);
    expect(titleMentionsTerm("3 Ekim'de neler oldu", "6 ekim")).toBe(false);
  });

  it("Türkçe olmayan başlık aramayı açıklamaz", async () => {
    const { headlineExplainsTerm } = await import("../src/topics-pipeline/pipeline.ts");
    const { looksTurkish } = await import("../src/topics-pipeline/text.ts");
    const en =
      "From Robert Pires to Leandro Trossard: Arsenal fans debate their most underrated player of all-time";
    expect(looksTurkish(en)).toBe(false);
    expect(headlineExplainsTerm(en, "leandro trossard")).toBe(false);
    expect(looksTurkish("Leandro Trossard Galatasaray'a mı geliyor?")).toBe(true);
    expect(looksTurkish("Arsenal Trossard transferini resmen duyurdu")).toBe(true);
    expect(looksTurkish("Trossard bei Bayern: Der Transfer ist fix und offiziell")).toBe(false);
  });
});
