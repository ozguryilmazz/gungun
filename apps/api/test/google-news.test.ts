import { describe, expect, it } from "vitest";
import { searchUrl, stripSourceSuffix } from "../src/ingest/providers/google-news-search.ts";

describe("Google Haberler araması", () => {
  it("arama adresi: Türkçe, son 1 gün, çok kelimeli terim tırnaklı", () => {
    const u = new URL(searchUrl("ali koç"));
    expect(u.hostname).toBe("news.google.com");
    expect(u.pathname).toBe("/rss/search");
    expect(u.searchParams.get("q")).toBe('"ali koç" when:1d');
    expect(u.searchParams.get("hl")).toBe("tr");
    expect(u.searchParams.get("gl")).toBe("TR");
    expect(new URL(searchUrl("trendyol")).searchParams.get("q")).toBe("trendyol when:1d");
  });

  it("başlıktaki ' - Kaynak' eki atılır", () => {
    expect(stripSourceSuffix("Trendyol'dan yeni kampanya - Hürriyet", "Hürriyet")).toBe(
      "Trendyol'dan yeni kampanya",
    );
    expect(stripSourceSuffix("Başlık - Başka", "Hürriyet")).toBe("Başlık - Başka");
    expect(stripSourceSuffix("Başlık", null)).toBe("Başlık");
  });
});
