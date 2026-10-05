import { describe, expect, it } from "vitest";
import { formatChange, formatClock, formatRelative, formatSearchVolume } from "../src/lib/format";

describe("formatRelative", () => {
  const now = new Date("2026-10-05T12:00:00Z");
  const ago = (min: number) => new Date(now.getTime() - min * 60_000).toISOString();

  it("Türkçe göreli zaman", () => {
    expect(formatRelative(ago(0), now)).toBe("az önce");
    expect(formatRelative(ago(4), now)).toBe("4 dk önce");
    expect(formatRelative(ago(125), now)).toBe("2 saat önce");
    expect(formatRelative(ago(60 * 50), now)).toBe("2 gün önce");
  });

  it("gelecekteki zaman 'az önce' olur (saat farkı toleransı)", () => {
    expect(formatRelative(ago(-3), now)).toBe("az önce");
  });
});

describe("formatClock", () => {
  it("İstanbul saatini kullanır (UTC+3)", () => {
    expect(formatClock("2026-10-05T07:00:00Z")).toBe("10:00");
  });
});

describe("formatChange", () => {
  it("işaretli yüzde", () => {
    expect(formatChange(67)).toBe("+67%");
    expect(formatChange(-52)).toBe("−52%");
    expect(formatChange(0)).toBe("0%");
  });
});

describe("formatSearchVolume", () => {
  it("Google'ın yaklaşık arama sayısı ve süre", () => {
    expect(formatSearchVolume({ approxTraffic: 50000, sinceHours: 3 })).toBe(
      "Yaklaşık 3 saatte 50.000+ arama",
    );
    expect(formatSearchVolume({ approxTraffic: 2000, sinceHours: 0 })).toBe(
      "Son 1 saatte 2.000+ arama",
    );
  });
});

describe("kendiliğinden güncelleme", () => {
  it("imza sıra veya skor değişince değişir; yeni giren konular bulunur", async () => {
    const { listSignature, newSlugs } = await import("../src/lib/refresh");
    const a = listSignature([
      { slug: "x", score: 50 },
      { slug: "y", score: 40 },
    ]);
    expect(
      listSignature([
        { slug: "x", score: 50 },
        { slug: "y", score: 40 },
      ]),
    ).toBe(a);
    expect(
      listSignature([
        { slug: "y", score: 40 },
        { slug: "x", score: 50 },
      ]),
    ).not.toBe(a);
    expect(
      listSignature([
        { slug: "x", score: 51 },
        { slug: "y", score: 40 },
      ]),
    ).not.toBe(a);
    expect(newSlugs(["x", "y"], ["z", "x", "y"])).toEqual(["z"]);
  });
});
