import { describe, expect, it } from "vitest";
import { CHART_W, PAD, spreadChart } from "../src/lib/spread-chart";

const now = new Date("2026-10-09T12:00:00Z");
const sites = [
  { name: "A", publishedAt: "2026-10-09T10:00:00Z" },
  { name: "B", publishedAt: "2026-10-09T10:20:00Z" },
  { name: "C", publishedAt: "2026-10-09T11:00:00Z" },
];

describe("spreadChart", () => {
  it("tek sitede grafik çizilmez (uydurma eğri yok)", () => {
    expect(spreadChart(sites.slice(0, 1), now)).toBeNull();
  });

  it("site sayısı her yeni sitede bir basamak artar; son nokta en üstte", () => {
    const c = spreadChart(sites, now)!;
    expect(c.points.map((p) => p.count)).toEqual([1, 2, 3]);
    expect(c.points[2]!.y).toBeLessThan(c.points[0]!.y);
    expect(c.points[0]!.x).toBe(PAD.left);
    // Şimdiye kadar uzar
    expect(c.xTicks[1]!.x).toBe(CHART_W - PAD.right);
    expect(c.path.startsWith("M")).toBe(true);
    expect(c.path.match(/V/g)).toHaveLength(2);
  });

  it("dikey eksen 0'dan site sayısına", () => {
    const c = spreadChart(sites, now)!;
    expect(c.yTicks.map((t) => t.value)).toEqual([0, 2, 3]);
  });
});
