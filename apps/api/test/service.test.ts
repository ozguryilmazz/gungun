import { describe, expect, it } from "vitest";
import {
  providerState,
  rankTopics,
  selectFalling,
  selectRising,
} from "../src/modules/topics/service.ts";
import { NOW, PROVIDERS, ROWS } from "./helpers.ts";

describe("rankTopics", () => {
  it("skora göre sıralar, skoru olmayan sonda ve sırasız", () => {
    const items = rankTopics(ROWS);
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

  it("değişim yüzdesi ve trend", () => {
    const top = rankTopics(ROWS)[0]!;
    expect(top.changePct).toBe(67);
    expect(top.trend).toBe("surging");
  });
});

describe("selectRising / selectFalling", () => {
  it("az kaynaklı konu yükselenlerde yer almaz", () => {
    const rising = selectRising(rankTopics(ROWS), 5);
    expect(rising.map((t) => t.slug)).toEqual(["ornek-yukselen"]);
  });

  it("düşenler", () => {
    expect(selectFalling(rankTopics(ROWS), 5).map((t) => t.slug)).toEqual(["ornek-dusen"]);
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
