import { describe, expect, it } from "vitest";
import { CATEGORIES } from "../src/categories.ts";
import { MOCK_TOPICS } from "../src/mock-topics.ts";
import { changePercent, classifyTrend, computeScore } from "../src/scoring.ts";

const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

describe("örnek konular", () => {
  it("örnek olduğu başlıktan ve slug'dan anlaşılıyor", () => {
    for (const t of MOCK_TOPICS) {
      expect(t.title.startsWith("Örnek: ")).toBe(true);
      expect(t.slug.startsWith("ornek-")).toBe(true);
      expect(t.summary.startsWith("Bu bir örnek konudur.")).toBe(true);
      for (const reason of t.reasons) expect(reason.startsWith("Örnek: ")).toBe(true);
    }
  });

  it("slug formatı, benzersizlik, kategori ve uzunluk kuralları", () => {
    const categorySlugs = new Set(CATEGORIES.map((c) => c.slug));
    expect(new Set(MOCK_TOPICS.map((t) => t.slug)).size).toBe(MOCK_TOPICS.length);
    for (const t of MOCK_TOPICS) {
      expect(t.slug).toMatch(SLUG_PATTERN);
      expect(t.slug.length).toBeLessThanOrEqual(160);
      expect(t.title.length).toBeLessThanOrEqual(200);
      expect(t.summary.length).toBeLessThanOrEqual(1200);
      expect(categorySlugs.has(t.categorySlug)).toBe(true);
      expect(t.snapshots[0].minutesAgo).toBeGreaterThan(t.snapshots[1].minutesAgo);
    }
  });

  it("arayüz durumlarını kapsıyor: yükselen, düşen ve eksik sinyalli konu", () => {
    const deltas = MOCK_TOPICS.map((t) => {
      const prev = computeScore(t.snapshots[0].normalized).score ?? 0;
      const next = computeScore(t.snapshots[1].normalized).score ?? 0;
      return next - prev;
    });
    expect(deltas.some((d) => d > 0)).toBe(true);
    expect(deltas.some((d) => d < 0)).toBe(true);
    expect(MOCK_TOPICS.some((t) => t.snapshots[1].normalized.search_interest === null)).toBe(true);
  });
});

describe("computeScore", () => {
  it("hiç sinyal yoksa skor üretmez", () => {
    const result = computeScore({
      news_visibility: null,
      velocity: null,
      search_interest: null,
      social: null,
    });
    expect(result.score).toBeNull();
    expect(result.signalsAvailable).toBe(0);
    expect(result.signalsTotal).toBe(4);
  });

  it("verisi olmayan bileşeni hesaba katmaz ve 'available=false' işaretler", () => {
    const result = computeScore({
      news_visibility: 1,
      velocity: 1,
      search_interest: null,
      social: null,
    });
    expect(result.score).toBe(100);
    expect(result.signalsAvailable).toBe(2);
    expect(result.components.search_interest).toEqual({
      available: false,
      normalized: null,
      raw: null,
    });
  });

  it("ağırlıklı ortalama hesaplar", () => {
    // (0.35*1 + 0.25*0 + 0.30*0.5) / 0.90 = 0.5555… → 56
    const result = computeScore({
      news_visibility: 1,
      velocity: 0,
      search_interest: 0.5,
      social: null,
    });
    expect(result.score).toBe(56);
  });

  it("0–1 dışındaki değeri reddeder", () => {
    expect(() =>
      computeScore({ news_visibility: 1.5, velocity: 0, search_interest: 0, social: null }),
    ).toThrow(RangeError);
  });
});

describe("changePercent / classifyTrend", () => {
  it("iki ölçüm yoksa değişim hesaplamaz", () => {
    expect(changePercent(null, 50)).toBeNull();
    expect(changePercent(50, null)).toBeNull();
    expect(changePercent(0, 50)).toBeNull();
  });

  it("yüzde değişimi yuvarlar", () => {
    expect(changePercent(55, 92)).toBe(67);
    expect(changePercent(69, 33)).toBe(-52);
  });

  it("eşiklere göre sınıflandırır", () => {
    expect(classifyTrend(null)).toBe("unknown");
    expect(classifyTrend(40)).toBe("surging");
    expect(classifyTrend(10)).toBe("rising");
    expect(classifyTrend(9)).toBe("flat");
    expect(classifyTrend(-9)).toBe("flat");
    expect(classifyTrend(-10)).toBe("falling");
  });
});
