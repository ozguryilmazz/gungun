import { youtubeVideos } from "@gundemci/db";
import { and, eq, lt } from "drizzle-orm";
import { z } from "zod";
import { describeError } from "../errors.ts";
import { BOT_USER_AGENT, type IngestProvider, type ProviderContext } from "../types.ts";

const API_HOST = "www.googleapis.com";
/** YouTube API şartları: API verisi en fazla 30 gün saklanır */
export const YOUTUBE_RETENTION_DAYS = 30;

const KEY_PATTERN = /^[A-Za-z0-9_-]{20,100}$/;
const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{6,32}$/;

const ThumbSchema = z.object({ url: z.string() }).partial().optional();

// Yalnızca kullandığımız alanlar; fazlası yok sayılır
const VideoSchema = z.object({
  id: z.string(),
  snippet: z.object({
    title: z.string(),
    channelTitle: z.string(),
    publishedAt: z.string().optional(),
    categoryId: z.string().optional(),
    thumbnails: z
      .object({ medium: ThumbSchema, high: ThumbSchema, default: ThumbSchema })
      .partial()
      .optional(),
  }),
  statistics: z.object({ viewCount: z.string().optional() }).optional(),
});

const ResponseSchema = z.object({ items: z.array(z.unknown()).max(200) });

export interface YoutubeVideo {
  videoId: string;
  rank: number;
  title: string;
  channelTitle: string;
  publishedAt: Date | null;
  viewCount: number | null;
  thumbnailUrl: string | null;
  categoryId: string | null;
}

/** Küçük resim yalnızca YouTube'un resim sunucusundan (CSP'de de yalnızca o izinli) */
function safeThumb(raw: string | undefined): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    return u.protocol === "https:" && u.hostname === "i.ytimg.com" && raw.length <= 512
      ? u.toString()
      : null;
  } catch {
    return null;
  }
}

export class YoutubeParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "YoutubeParseError";
  }
}

/** API yanıtını doğrular; bozuk öğeler atlanır, sıra listedeki konumdur */
export function parseYoutubeTrending(body: Buffer | string): YoutubeVideo[] {
  let json: unknown;
  try {
    json = JSON.parse(body.toString());
  } catch {
    throw new YoutubeParseError("JSON okunamadı");
  }
  const parsed = ResponseSchema.safeParse(json);
  if (!parsed.success) throw new YoutubeParseError("Beklenmeyen yanıt biçimi");

  const out: YoutubeVideo[] = [];
  const seen = new Set<string>();
  parsed.data.items.forEach((raw, index) => {
    const v = VideoSchema.safeParse(raw);
    if (!v.success || !VIDEO_ID_PATTERN.test(v.data.id) || seen.has(v.data.id)) return;
    const s = v.data.snippet;
    const title = s.title.trim().slice(0, 300);
    const channelTitle = s.channelTitle.trim().slice(0, 200);
    if (!title || !channelTitle) return;
    seen.add(v.data.id);
    const published = s.publishedAt ? new Date(s.publishedAt) : null;
    const views = Number(v.data.statistics?.viewCount);
    out.push({
      videoId: v.data.id,
      rank: index + 1,
      title,
      channelTitle,
      publishedAt: published && !Number.isNaN(published.getTime()) ? published : null,
      viewCount: Number.isSafeInteger(views) && views >= 0 ? views : null,
      thumbnailUrl: safeThumb(
        s.thumbnails?.medium?.url ?? s.thumbnails?.high?.url ?? s.thumbnails?.default?.url,
      ),
      categoryId: s.categoryId && /^\d{1,8}$/.test(s.categoryId) ? s.categoryId : null,
    });
  });
  return out;
}

function failed(code: string, message: string) {
  return {
    status: "failed" as const,
    itemsFetched: 0,
    details: [{ name: "YouTube", ok: false, items: 0, error: `${code}: ${message}` }],
    errorCode: code,
    errorMessage: message,
  };
}

/**
 * YouTube Türkiye'de trend videolar — resmi YouTube Data API v3 (`chart=mostPopular`).
 * API anahtarı adrese DEĞİL istek başlığına (X-Goog-Api-Key) konur: hiçbir log/hata kaydında görünmez.
 */
export const youtubeTrendingProvider: IngestProvider = {
  key: "youtube_trending",

  async run(ctx: ProviderContext) {
    const { db, provider, now, fetcher, log, secrets } = ctx;
    const key = secrets.youtubeApiKey;
    if (!key) return failed("missing_key", "YOUTUBE_API_KEY tanımlı değil (.env)");
    if (!KEY_PATTERN.test(key)) return failed("invalid_key", "YOUTUBE_API_KEY biçimi geçersiz");

    const region =
      typeof provider.config.regionCode === "string" &&
      /^[A-Z]{2}$/.test(provider.config.regionCode)
        ? provider.config.regionCode
        : "TR";
    const max =
      typeof provider.config.maxResults === "number"
        ? Math.min(Math.max(Math.trunc(provider.config.maxResults), 1), 50)
        : 50;
    const url = new URL(`https://${API_HOST}/youtube/v3/videos`);
    url.search = new URLSearchParams({
      part: "snippet,statistics",
      chart: "mostPopular",
      regionCode: region,
      hl: "tr",
      maxResults: String(max),
    }).toString();

    try {
      const res = await fetcher(url.toString(), {
        isHostAllowed: (host) => host === API_HOST,
        userAgent: BOT_USER_AGENT,
        accept: "application/json",
        headers: { "x-goog-api-key": key },
        maxRedirects: 0,
      });
      const videos = parseYoutubeTrending(res.body);
      let inserted = 0;
      if (videos.length > 0) {
        const rows = await db
          .insert(youtubeVideos)
          .values(videos.map((v) => ({ ...v, providerId: provider.id, observedAt: now })))
          .onConflictDoNothing()
          .returning({ id: youtubeVideos.id });
        inserted = rows.length;
      }
      await db
        .delete(youtubeVideos)
        .where(
          and(
            eq(youtubeVideos.providerId, provider.id),
            lt(
              youtubeVideos.observedAt,
              new Date(now.getTime() - YOUTUBE_RETENTION_DAYS * 86_400_000),
            ),
          ),
        );
      return {
        status: "success" as const,
        itemsFetched: inserted,
        details: [{ name: "YouTube", ok: true, items: inserted, parsed: videos.length }],
      };
    } catch (error) {
      if (error instanceof YoutubeParseError) return failed("parse_error", error.message);
      const { code, message } = describeError(error);
      // 400/403: anahtar geçersiz, API kısıtı yanlış veya günlük kota dolmuş
      const hint =
        message === "HTTP 400" || message === "HTTP 403"
          ? `${message} — anahtar geçersiz/kısıtlı ya da günlük kota dolmuş olabilir`
          : message;
      log.warn({ code, message }, "YouTube trendleri alınamadı");
      return failed(code, hint);
    }
  },
};
