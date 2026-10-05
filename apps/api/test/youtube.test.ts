import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  YoutubeParseError,
  parseYoutubeTrending,
} from "../src/ingest/providers/youtube-trending.ts";
import { youtubeSocial } from "../src/topics-pipeline/pipeline.ts";

const fixture = readFileSync(new URL("./fixtures/youtube.json", import.meta.url));

describe("YouTube yanıt ayrıştırma", () => {
  it("geçerli videolar sırasıyla alınır; bozuk ve tekrar eden öğeler atlanır", () => {
    const videos = parseYoutubeTrending(fixture);
    expect(videos.map((v) => v.videoId)).toEqual(["abcDEF12345", "zzzYYY98765", "derbi000002"]);
    // Sıra listedeki konumdur (atlanan öğeler sırayı kaydırmaz)
    expect(videos.map((v) => v.rank)).toEqual([1, 2, 5]);
    expect(videos[0]).toMatchObject({
      title: "Derbi özeti: Fenerbahçe 2-1 Galatasaray",
      channelTitle: "Spor Kanalı",
      viewCount: 1_250_000,
      categoryId: "17",
      thumbnailUrl: "https://i.ytimg.com/vi/abcDEF12345/mqdefault.jpg",
    });
  });

  it("YouTube dışı küçük resim ve sayı olmayan izlenme reddedilir", () => {
    const [, second] = parseYoutubeTrending(fixture);
    expect(second?.thumbnailUrl).toBeNull();
    expect(second?.viewCount).toBeNull();
  });

  it("JSON olmayan veya beklenmeyen yanıt hata verir", () => {
    expect(() => parseYoutubeTrending("<html>")).toThrow(YoutubeParseError);
    expect(() => parseYoutubeTrending('{"error":{}}')).toThrow(YoutubeParseError);
  });
});

describe("sosyal sinyal (YouTube)", () => {
  const videos = [
    { title: "Derbi özeti: Fenerbahçe 2-1 Galatasaray", rank: 1 },
    { title: "Derbide tartışmalı pozisyon", rank: 5 },
    { title: "AK Parti Sözcüsü açıklama yaptı", rank: 3 },
  ];

  it("terim video başlığında geçerse sıraya göre değer; ek video bonus", () => {
    const r = youtubeSocial("derbi", videos);
    expect(r.matches).toBe(2);
    expect(r.bestRank).toBe(1);
    expect(r.value).toBe(1);
    expect(youtubeSocial("derbi", [{ title: "Derbi", rank: 50 }]).value).toBeCloseTo(0.3, 4);
  });

  it("eşleşme yoksa 0; medya adı ve iyelik ekli kullanım eşleşmez", () => {
    expect(youtubeSocial("deprem", videos)).toEqual({ value: 0, matches: 0, bestRank: null });
    expect(youtubeSocial("sözcü", videos).matches).toBe(0);
  });
});
