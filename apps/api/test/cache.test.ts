import { describe, expect, it } from "vitest";
import { TtlCache } from "../src/lib/cache.ts";

describe("TtlCache", () => {
  it("süresi dolan kaydı döndürmez", () => {
    let t = 0;
    const cache = new TtlCache<number>(1000, 10, () => t);
    cache.set("a", 1);
    expect(cache.get("a")).toBe(1);
    t = 1000;
    expect(cache.get("a")).toBeUndefined();
  });

  it("kapasite dolunca en eski kaydı atar", () => {
    const cache = new TtlCache<number>(60_000, 2);
    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("c", 3);
    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("c")).toBe(3);
  });

  it("ttl=0 iken önbelleğe almaz", () => {
    const cache = new TtlCache<number>(0);
    cache.set("a", 1);
    expect(cache.get("a")).toBeUndefined();
  });

  it("eşzamanlı istekleri tek yüklemede birleştirir", async () => {
    const cache = new TtlCache<number>(60_000);
    let loads = 0;
    const load = async () => {
      loads++;
      await new Promise((r) => setTimeout(r, 10));
      return 42;
    };
    const results = await Promise.all([cache.getOrLoad("k", load), cache.getOrLoad("k", load)]);
    expect(results).toEqual([42, 42]);
    expect(loads).toBe(1);
  });

  it("yükleme hatası önbelleğe alınmaz", async () => {
    const cache = new TtlCache<number>(60_000);
    await expect(
      cache.getOrLoad("k", async () => Promise.reject(new Error("x"))),
    ).rejects.toThrow();
    expect(await cache.getOrLoad("k", async () => 7)).toBe(7);
  });
});
