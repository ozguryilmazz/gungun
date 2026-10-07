import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DataUnavailableError,
  getRising,
  getStatus,
  getTopic,
  getTopicList,
} from "../src/lib/data";

const NOW = "2026-10-05T12:00:00.000Z";

const summary = {
  slug: "ornek-konu",
  title: "Örnek: Konu",
  kind: "trend",
  headline: { title: "Kaynak başlığı", source: "Örnek", url: "https://example.org/h" },
  category: { slug: "teknoloji", name: "Teknoloji" },
  rank: 1,
  score: 92,
  previousScore: 55,
  changePct: 67,
  trend: "surging",
  signalsAvailable: 3,
  signalsTotal: 4,
  sourceCount: 4,
  searchVolume: { approxTraffic: 50000, sinceHours: 3 },
  sparkline: [55, 70, 92],
  movement: { kind: "up", by: 2 },
  summary: "Bu bir örnek konudur.",
  updatedAt: NOW,
  isMock: true,
};

const listBody = { items: [summary], meta: { generatedAt: NOW, isMock: true } };

const detailBody = {
  item: {
    ...summary,
    isArchived: false,
    reasons: ["Örnek: neden"],
    summaryOrigin: "manual",
    firstSeenAt: NOW,
    components: [
      { key: "news_visibility", label: "Haber görünürlüğü", available: true, value: 90 },
    ],
    timeline: [],
    sources: [
      { title: "Kaynak", url: "https://example.org/1", publisherName: "Örnek", publishedAt: NOW },
    ],
  },
  meta: { generatedAt: NOW, isMock: true },
};

const fetchMock = vi.fn<typeof fetch>();
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const requestedUrl = (call = 0) => String(fetchMock.mock.calls[call]?.[0]);

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("veri katmanı → API", () => {
  it("listeyi API'den alır ve sözleşmeyle doğrular", async () => {
    fetchMock.mockResolvedValue(json(listBody));
    const result = await getTopicList({ category: "spor", limit: 5 });
    expect(result.items[0]?.slug).toBe("ornek-konu");
    expect(requestedUrl()).toBe(
      "http://127.0.0.1:4000/api/v1/topics?kind=trend&limit=5&category=spor",
    );
  });

  it("limit sınırlanır", async () => {
    fetchMock.mockResolvedValue(json(listBody));
    await getRising(10_000);
    expect(requestedUrl()).toContain("limit=50");
  });

  it("detay: 404 → null", async () => {
    fetchMock.mockResolvedValue(json({ error: { code: "not_found", message: "x" } }, 404));
    expect(await getTopic("olmayan-konu")).toBeNull();
  });

  it("detay: başarılı yanıt", async () => {
    fetchMock.mockResolvedValue(json(detailBody));
    const result = await getTopic("ornek-konu");
    expect(result?.item.sources[0]?.url).toBe("https://example.org/1");
    expect(requestedUrl()).toBe("http://127.0.0.1:4000/api/v1/topics/ornek-konu");
  });

  it("geçersiz slug API'ye hiç gönderilmez", async () => {
    for (const slug of ["../../etc/passwd", "https://kotu.example", "a/b", "<script>", ""]) {
      expect(await getTopic(slug)).toBeNull();
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sözleşmeye uymayan yanıt (ör. zararlı link) reddedilir", async () => {
    const bad = structuredClone(detailBody);
    bad.item.sources[0]!.url = "javascript:alert(1)";
    fetchMock.mockResolvedValue(json(bad));
    await expect(getTopic("ornek-konu")).rejects.toBeInstanceOf(DataUnavailableError);
  });

  it("önbellekteki eski sürüm yanıtı uymazsa önbellek atlanıp bir kez yeniden istenir", async () => {
    // Güncelleme sonrası önbellekte yeni alanları olmayan eski yanıt kalmış olabilir
    const { sparkline: _omit, ...oldSummary } = summary;
    void _omit;
    fetchMock
      .mockResolvedValueOnce(json({ ...listBody, items: [oldSummary] }))
      .mockResolvedValueOnce(json(listBody));
    const list = await getTopicList();
    expect(list.items[0]?.sparkline).toEqual([55, 70, 92]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[1]?.cache).toBe("no-store");
    expect(console.error).not.toHaveBeenCalled();
  });

  it("API hatası, ağ hatası ve bozuk JSON → DataUnavailableError", async () => {
    fetchMock.mockResolvedValueOnce(json({ error: {} }, 500));
    await expect(getTopicList()).rejects.toBeInstanceOf(DataUnavailableError);
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));
    await expect(getTopicList()).rejects.toBeInstanceOf(DataUnavailableError);
    fetchMock.mockResolvedValueOnce(new Response("<html>", { status: 200 }));
    await expect(getStatus()).rejects.toBeInstanceOf(DataUnavailableError);
  });

  it("yönlendirme izlenmez ve zaman aşımı ayarlı", async () => {
    fetchMock.mockResolvedValue(json(listBody));
    await getTopicList();
    const init = fetchMock.mock.calls[0]?.[1];
    expect(init?.redirect).toBe("error");
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });
});

describe("arşiv", () => {
  it("geçersiz tarih API'ye gönderilmez", async () => {
    const { getArchiveDay } = await import("../src/lib/data");
    for (const d of ["2026-13-40", "../../x", "2026-1-5", ""])
      expect(await getArchiveDay(d)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
