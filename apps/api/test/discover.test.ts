import { describe, expect, it } from "vitest";
import { extractExternalSites, findFeedLinks, pageTitle } from "../src/ingest/discover.ts";

describe("RSS keşfi", () => {
  it("dizin sayfasından dış haber siteleri (sosyal medya ve kendisi hariç, tekrarsız)", () => {
    const html = `
      <a href="https://www.hurriyet.com.tr/">Hürriyet</a>
      <a href='https://www.hurriyet.com.tr/gundem/'>Hürriyet gündem</a>
      <a href="https://www.gazeteler.de/spor">iç sayfa</a>
      <a href="https://facebook.com/gazeteler">fb</a>
      <a href="//www.sozcu.com.tr">Sözcü</a>
      <a href="javascript:void(0)">x</a>
      <a href="mailto:a@b.c">mail</a>`;
    expect(extractExternalSites(html, "https://www.gazeteler.de/")).toEqual([
      "https://www.hurriyet.com.tr/",
      "https://www.sozcu.com.tr/",
    ]);
  });

  it("ana sayfadaki RSS etiketleri (göreli adres çözülür)", () => {
    const html = `<head>
      <link rel="alternate" type="application/rss+xml" title="Son dakika" href="/rss/sondakika.xml">
      <link type="application/atom+xml" rel="alternate" href="https://feeds.ornek.com/atom">
      <link rel="stylesheet" href="/a.css">
      <link rel="alternate" hreflang="en" href="https://ornek.com/en"></head>`;
    expect(findFeedLinks(html, "https://www.ornek.com/")).toEqual([
      "https://www.ornek.com/rss/sondakika.xml",
      "https://feeds.ornek.com/atom",
    ]);
  });

  it("site adı tahmini: başlığın kısa parçası", () => {
    expect(pageTitle("<title>Son Dakika Haberler ve Güncel Gelişmeler - T24</title>")).toBe("T24");
    expect(pageTitle("<title>BirGün</title>")).toBe("BirGün");
    expect(pageTitle("<html></html>")).toBeNull();
  });
});
