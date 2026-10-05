import { describe, expect, it } from "vitest";
import { CATEGORIES, DATA_PROVIDERS, PUBLISHERS } from "../src/seed/reference-data.js";

describe("kategoriler", () => {
  it("planlanan 12 kategori, benzersiz slug ve sıra", () => {
    expect(CATEGORIES).toHaveLength(12);
    expect(new Set(CATEGORIES.map((c) => c.slug)).size).toBe(12);
    expect(new Set(CATEGORIES.map((c) => c.sortOrder)).size).toBe(12);
    for (const c of CATEGORIES) expect(c.slug).toMatch(/^[a-z]+$/);
  });
});

describe("yayıncılar", () => {
  it("alan adları ve feed adresleri benzersiz", () => {
    expect(new Set(PUBLISHERS.map((p) => p.domain)).size).toBe(PUBLISHERS.length);
    expect(new Set(PUBLISHERS.map((p) => p.feedUrl)).size).toBe(PUBLISHERS.length);
  });

  it("tüm adresler geçerli https URL ve ana sayfa kayıtlı alan adına ait", () => {
    for (const p of PUBLISHERS) {
      const home = new URL(p.homepageUrl);
      const feed = new URL(p.feedUrl);
      expect(home.protocol).toBe("https:");
      expect(feed.protocol).toBe("https:");
      expect(home.hostname === p.domain || home.hostname.endsWith(`.${p.domain}`)).toBe(true);
      // Kimlik bilgisi veya standart dışı port içeren adres allowlist'e girmemeli
      for (const u of [home, feed]) {
        expect(u.username).toBe("");
        expect(u.password).toBe("");
        expect(u.port).toBe("");
      }
    }
  });
});

describe("veri sağlayıcıları", () => {
  it("benzersiz anahtarlar, config içinde secret yok", () => {
    expect(new Set(DATA_PROVIDERS.map((p) => p.key)).size).toBe(DATA_PROVIDERS.length);
    const serialized = JSON.stringify(DATA_PROVIDERS).toLowerCase();
    for (const word of ["apikey", "api_key", "secret", "token", "password"]) {
      expect(serialized).not.toContain(word);
    }
  });
});
