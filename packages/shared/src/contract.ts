// Public API sözleşmesi. Backend bu şemalara uyan yanıt üretir, frontend gelen yanıtı
// bu şemalarla DOĞRULAR (güvenilmeyen veri gibi davranır).
import { z } from "zod";
import { COMPONENT_KEYS } from "./scoring.ts";

const isoDate = z.iso.datetime({ offset: true });
const slug = z
  .string()
  .max(160)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/);
const score = z.number().int().min(0).max(100);

/** Yalnızca http(s) bağlantılar; javascript:, data: vb. reddedilir */
export const SafeUrlSchema = z.url({ protocol: /^https?$/ }).max(2048);

export const CategorySchema = z.object({
  slug: z.string().max(32),
  name: z.string().max(64),
});

export const TrendSchema = z.enum(["surging", "rising", "flat", "falling", "unknown"]);

/** trend: Google'da trend olan arama · news: aramada olmayan ama çok kaynakta geçen haber */
export const TopicKindSchema = z.enum(["trend", "news"]);

/** Kartta gösterilen, kaynağı belirtilmiş en güncel haber başlığı (bizim yazdığımız metin değil) */
export const HeadlineSchema = z.object({
  title: z.string().min(1).max(300),
  source: z.string().max(96),
  url: SafeUrlSchema,
});

export const TopicSummarySchema = z.object({
  slug,
  title: z.string().min(1).max(200),
  kind: TopicKindSchema,
  headline: HeadlineSchema.nullable(),
  category: CategorySchema,
  rank: z.number().int().positive().nullable(),
  /** null = hiç sinyal yok, skor hesaplanmadı */
  score: score.nullable(),
  previousScore: score.nullable(),
  /** null = karşılaştırılacak iki ölçüm yok */
  changePct: z.number().int().nullable(),
  trend: TrendSchema,
  signalsAvailable: z.number().int().min(0),
  signalsTotal: z.number().int().min(0),
  sourceCount: z.number().int().min(0),
  /**
   * Trend konusunda Google'ın verdiği YAKLAŞIK arama sayısı ("50.000+") ve konunun kaç saattir
   * trend listesinde olduğu. Yalnızca arama şu an listedeyse; aksi hâlde null.
   */
  searchVolume: z
    .object({
      approxTraffic: z.number().int().positive(),
      sinceHours: z.number().int().min(0),
    })
    .nullable(),
  /** Son 24 saatin saatlik skorları (eskiden yeniye; her saatin son ölçümü) — mini grafik için */
  sparkline: z.array(score).max(25),
  summary: z.string().max(1200).nullable(),
  updatedAt: isoDate,
  isMock: z.boolean(),
});

export const ScoreComponentViewSchema = z.object({
  key: z.enum(COMPONENT_KEYS as [string, ...string[]]),
  label: z.string(),
  available: z.boolean(),
  /** 0–100; available=false ise null */
  value: score.nullable(),
});

export const TimelineEventViewSchema = z.object({
  type: z.enum([
    "first_source",
    "news_spread",
    "search_spike",
    "entered_top5",
    "peak",
    "trend_listed",
    "trend_left",
  ]),
  occurredAt: isoDate,
});

export const SourceViewSchema = z.object({
  title: z.string().min(1).max(300),
  url: SafeUrlSchema,
  publisherName: z.string().max(96),
  publishedAt: isoDate.nullable(),
});

export const TopicDetailSchema = TopicSummarySchema.extend({
  /** true: konu artık gündemde değil, arşivden görüntüleniyor */
  isArchived: z.boolean(),
  reasons: z.array(z.string().max(300)).max(10),
  summaryOrigin: z.enum(["none", "manual", "ai"]),
  firstSeenAt: isoDate,
  components: z.array(ScoreComponentViewSchema),
  timeline: z.array(TimelineEventViewSchema),
  sources: z.array(SourceViewSchema),
});

export const ResponseMetaSchema = z.object({
  generatedAt: isoDate,
  /** true ise yanıttaki veriler ÖRNEK veridir */
  isMock: z.boolean(),
});

export const TopicListResponseSchema = z.object({
  items: z.array(TopicSummarySchema),
  meta: ResponseMetaSchema,
});

export const TopicDetailResponseSchema = z.object({
  item: TopicDetailSchema,
  meta: ResponseMetaSchema,
});

export const TopicHistoryResponseSchema = z.object({
  items: z.array(z.object({ capturedAt: isoDate, score: score.nullable() })),
  meta: ResponseMetaSchema,
});

export const CategoryListResponseSchema = z.object({
  items: z.array(CategorySchema),
});

/** Veri kaynaklarının kullanıcıya gösterilebilir durumu (hata ayrıntısı İÇERMEZ) */
export const ProviderStatusSchema = z.object({
  key: z.string(),
  kind: z.enum(["trend", "news", "social", "manual"]),
  name: z.string(),
  state: z.enum(["not_connected", "ok", "stale", "error"]),
  lastSuccessAt: isoDate.nullable(),
});

export const StatusResponseSchema = z.object({
  providers: z.array(ProviderStatusSchema),
  generatedAt: isoDate,
});

/** Tüm hata yanıtlarının tek biçimi; message kullanıcıya gösterilebilir Türkçe metindir */
export const ErrorResponseSchema = z.object({
  error: z.object({
    code: z.enum([
      "invalid_request",
      "not_found",
      "rate_limited",
      "internal_error",
      "service_unavailable",
    ]),
    message: z.string(),
  }),
});

/** YYYY-AA-GG biçimli, takvimde var olan bir gün */
export const ArchiveDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((v) => {
    const d = new Date(`${v}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(v);
  });

export const ArchiveItemSchema = z.object({
  slug,
  title: z.string().min(1).max(200),
  category: CategorySchema,
  /** O günkü en yüksek gündem skoru */
  peakScore: score.nullable(),
  rank: z.number().int().positive(),
  firstSeenAt: isoDate,
  sourceCount: z.number().int().min(0),
  isMock: z.boolean(),
});

export const ArchiveDayResponseSchema = z.object({
  date: ArchiveDateSchema,
  items: z.array(ArchiveItemSchema),
  meta: ResponseMetaSchema,
});

export const ArchiveIndexResponseSchema = z.object({
  days: z.array(z.object({ date: ArchiveDateSchema, topicCount: z.number().int().min(0) })),
});

/** YouTube Türkiye trend videosu (resmi YouTube Data API; başlık/kanal değiştirilmeden) */
export const YoutubeVideoSchema = z.object({
  rank: z.number().int().positive(),
  videoId: z.string().regex(/^[A-Za-z0-9_-]{6,32}$/),
  title: z.string().min(1).max(300),
  channelTitle: z.string().min(1).max(200),
  /** Her zaman https://www.youtube.com/watch?v=… — video sitede oynatılmaz */
  url: SafeUrlSchema,
  thumbnailUrl: z
    .url({ protocol: /^https$/, hostname: /^i\.ytimg\.com$/ })
    .max(512)
    .nullable(),
  viewCount: z.number().int().min(0).nullable(),
  publishedAt: isoDate.nullable(),
});

export const YoutubeListResponseSchema = z.object({
  items: z.array(YoutubeVideoSchema),
  /** Listenin YouTube'dan alındığı an; hiç veri yoksa null */
  observedAt: isoDate.nullable(),
  meta: ResponseMetaSchema,
});

export type YoutubeVideo = z.infer<typeof YoutubeVideoSchema>;
export type YoutubeListResponse = z.infer<typeof YoutubeListResponseSchema>;
export type ArchiveItem = z.infer<typeof ArchiveItemSchema>;
export type ArchiveDayResponse = z.infer<typeof ArchiveDayResponseSchema>;
export type ArchiveIndexResponse = z.infer<typeof ArchiveIndexResponseSchema>;
export type TopicHistoryResponse = z.infer<typeof TopicHistoryResponseSchema>;
export type CategoryListResponse = z.infer<typeof CategoryListResponseSchema>;
export type ProviderStatus = z.infer<typeof ProviderStatusSchema>;
export type StatusResponse = z.infer<typeof StatusResponseSchema>;
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;
export type Category = z.infer<typeof CategorySchema>;
export type TopicKind = z.infer<typeof TopicKindSchema>;
export type Headline = z.infer<typeof HeadlineSchema>;
export type TopicSummary = z.infer<typeof TopicSummarySchema>;
export type TopicDetail = z.infer<typeof TopicDetailSchema>;
export type ScoreComponentView = z.infer<typeof ScoreComponentViewSchema>;
export type TimelineEventView = z.infer<typeof TimelineEventViewSchema>;
export type SourceView = z.infer<typeof SourceViewSchema>;
export type ResponseMeta = z.infer<typeof ResponseMetaSchema>;
export type TopicListResponse = z.infer<typeof TopicListResponseSchema>;
export type TopicDetailResponse = z.infer<typeof TopicDetailResponseSchema>;

export const TIMELINE_LABELS: Record<TimelineEventView["type"], string> = {
  first_source: "İlk kaynakta yer aldı",
  news_spread: "Birden fazla yayıncıda yer aldı",
  search_spike: "Arama ilgisinde sıçrama",
  entered_top5: "Gündem sıralamasında ilk 5’e girdi",
  peak: "Zirve skora ulaştı",
  trend_listed: "Google Türkiye trend listesine girdi",
  trend_left: "Trend listesinden çıktı",
};

/** URL'deki slug parametresini veritabanına/API'ye gitmeden önce doğrular */
export function isValidSlug(value: string): boolean {
  return slug.safeParse(value).success;
}
