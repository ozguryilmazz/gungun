import { describe, expect, it } from "vitest";
import { sparklinePoints } from "../src/lib/sparkline";

const ys = (pts: string) => pts.split(" ").map((p) => Number(p.split(",")[1]));

describe("sparklinePoints", () => {
  it("yükselen seri: son nokta en üstte (SVG'de y küçük)", () => {
    const y = ys(sparklinePoints([10, 50, 90]));
    expect(y[0]).toBeGreaterThan(y[2]!);
  });

  it("küçük dalgalanma abartılmaz: 50→52 çizginin yalnızca küçük bir kısmını kaplar", () => {
    const y = ys(sparklinePoints([50, 52]));
    expect(Math.abs(y[0]! - y[1]!)).toBeLessThan(3);
  });

  it("sabit seri düz çizgi", () => {
    const y = ys(sparklinePoints([40, 40, 40]));
    expect(new Set(y).size).toBe(1);
  });
});
