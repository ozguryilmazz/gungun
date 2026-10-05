import { RISING_MIN_SOURCES } from "@gundemci/shared";
import { describe, expect, it } from "vitest";
import { getFalling, getRising, getTopic, getTopicList } from "../src/lib/data";

describe("veri katmanı (örnek veri)", () => {
  it("her yanıt örnek veri olarak işaretli", async () => {
    const list = await getTopicList();
    expect(list.meta.isMock).toBe(true);
    expect(list.items.length).toBeGreaterThan(0);
    for (const t of list.items) {
      expect(t.isMock).toBe(true);
      expect(t.title.startsWith("Örnek:")).toBe(true);
    }
  });

  it("liste skora göre sıralı ve sıra numaraları ardışık", async () => {
    const { items } = await getTopicList();
    items.forEach((t, i) => expect(t.rank).toBe(i + 1));
    for (let i = 1; i < items.length; i++) {
      expect(items[i - 1]!.score ?? -1).toBeGreaterThanOrEqual(items[i]!.score ?? -1);
    }
  });

  it("kategori filtresi ve limit sınırları", async () => {
    const spor = await getTopicList({ category: "spor" });
    expect(spor.items.every((t) => t.category.slug === "spor")).toBe(true);
    expect((await getTopicList({ category: "olmayan" })).items).toHaveLength(0);
    expect((await getTopicList({ limit: 2 })).items).toHaveLength(2);
    expect((await getTopicList({ limit: -5 })).items).toHaveLength(1);
    expect((await getTopicList({ limit: 10_000 })).items.length).toBeLessThanOrEqual(50);
  });

  it("yükselenler: yalnızca yükselen ve yeterli kaynaklı konular, azalan sırada", async () => {
    const { items } = await getRising();
    expect(items.length).toBeGreaterThan(0);
    for (const t of items) {
      expect(["surging", "rising"]).toContain(t.trend);
      expect(t.sourceCount).toBeGreaterThanOrEqual(RISING_MIN_SOURCES);
    }
    for (let i = 1; i < items.length; i++) {
      expect(items[i - 1]!.changePct!).toBeGreaterThanOrEqual(items[i]!.changePct!);
    }
    // Uzay konusu +%100'ün üzerinde yükseliyor ama yalnızca 2 kaynakta: listede olmamalı
    expect(items.some((t) => t.slug === "ornek-uzay-gorevi-firlatmasi")).toBe(false);
  });

  it("düşenler yalnızca düşen konular", async () => {
    const { items } = await getFalling();
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((t) => t.trend === "falling")).toBe(true);
  });

  it("detay: verisi olmayan sinyal 'available=false' ve değeri yok", async () => {
    const result = await getTopic("ornek-uzay-gorevi-firlatmasi");
    expect(result).not.toBeNull();
    const search = result!.item.components.find((c) => c.key === "search_interest");
    expect(search).toEqual(expect.objectContaining({ available: false, value: null }));
    expect(result!.item.signalsAvailable).toBe(2);
  });

  it("detay: kaynak bağlantıları yalnızca örnek alan adına gider", async () => {
    const result = await getTopic("ornek-yeni-nesil-akilli-telefon-tanitimi");
    for (const s of result!.item.sources) expect(new URL(s.url).hostname).toBe("example.org");
    expect(result!.item.timeline.length).toBeGreaterThan(0);
  });

  it("geçersiz veya bilinmeyen slug null döner", async () => {
    for (const slug of ["../../etc/passwd", "<script>", "OLMAYAN", "", "olmayan-konu"]) {
      expect(await getTopic(slug)).toBeNull();
    }
  });
});
