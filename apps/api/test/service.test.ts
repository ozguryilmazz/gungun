import { describe, expect, it } from "vitest";
import {
  movement,
  providerState,
  rankTopics,
  selectFalling,
  selectRising,
} from "../src/modules/topics/service.ts";
import { NOW, PROVIDERS, ROWS, TREND_ROWS } from "./helpers.ts";

describe("rankTopics", () => {
  it("skora göre sıralar, skoru olmayan sonda ve sırasız", () => {
    const items = rankTopics(TREND_ROWS);
    expect(items.map((t) => t.slug)).toEqual([
      "ornek-yukselen",
      "ornek-az-kaynakli",
      "ornek-dusen",
      "ornek-skorsuz",
    ]);
    expect(items.map((t) => t.rank)).toEqual([1, 2, 3, null]);
    const unscored = items[3]!;
    expect(unscored.score).toBeNull();
    expect(unscored.changePct).toBeNull();
    expect(unscored.trend).toBe("unknown");
  });

  it("aramayı açıklayan haberi olmayan trend konusu, skoru yüksek olsa da sonra gelir", () => {
    const rows = TREND_ROWS.map((r) =>
      r.slug === "ornek-yukselen" ? { ...r, sourceCount: 0 } : r,
    );
    const items = rankTopics(rows);
    expect(items.map((t) => t.slug)).toEqual([
      "ornek-az-kaynakli",
      "ornek-dusen",
      "ornek-yukselen",
      "ornek-skorsuz",
    ]);
    // Skor değişmez, yalnızca sıra
    expect(items[2]?.score).toBe(rankTopics(TREND_ROWS)[0]?.score);
    expect(items[2]?.rank).toBe(3);
  });

  it("değişim yüzdesi ve trend", () => {
    const top = rankTopics(TREND_ROWS)[0]!;
    expect(top.changePct).toBe(67);
    expect(top.trend).toBe("surging");
  });
});

describe("selectRising / selectFalling", () => {
  it("trend konularında kaynak eşiği yok; haber konularında az kaynaklı konu elenir", () => {
    const rising = selectRising(rankTopics(TREND_ROWS), 5);
    expect(rising.map((t) => t.slug)).toEqual(["ornek-az-kaynakli", "ornek-yukselen"]);
    const news = rankTopics(ROWS.filter((r) => r.kind === "news"));
    expect(news[0]?.changePct).toBe(200);
    expect(selectRising(news, 5)).toHaveLength(0);
  });

  it("düşenler", () => {
    expect(selectFalling(rankTopics(TREND_ROWS), 5).map((t) => t.slug)).toEqual(["ornek-dusen"]);
  });
});

describe("providerState", () => {
  it("kapalı → not_connected, güncel → ok", () => {
    expect(providerState(PROVIDERS[0]!, NOW)).toBe("not_connected");
    expect(providerState(PROVIDERS[1]!, NOW)).toBe("ok");
  });

  it("uzun süredir başarı yok → stale, son deneme hatalı → error", () => {
    const base = PROVIDERS[1]!;
    expect(
      providerState({ ...base, lastSuccessAt: new Date(NOW.getTime() - 3_600_000) }, NOW),
    ).toBe("stale");
    expect(providerState({ ...base, consecutiveFailures: 2, lastErrorAt: NOW }, NOW)).toBe("error");
  });
});

describe("sıra değişimi", () => {
  it("1 saat önceki sıraya göre yükseliş, düşüş, aynı, yeni giriş", () => {
    expect(movement(2, 5)).toEqual({ kind: "up", by: 3 });
    expect(movement(4, 1)).toEqual({ kind: "down", by: 3 });
    expect(movement(3, 3)).toEqual({ kind: "same", by: 0 });
    expect(movement(6, "none")).toEqual({ kind: "new", by: 0 });
    // Sırası yok ya da karşılaştırılacak yakın ölçüm yok → gösterilmez
    expect(movement(null, 2)).toBeNull();
    expect(movement(2, null)).toBeNull();
  });
});
