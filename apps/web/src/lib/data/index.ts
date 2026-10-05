// Arayüzün tek veri erişim noktası. Yalnızca sunucuda çalışır; tarayıcıya gönderilmez.
// Tüm veri backend API'den gelir (apps/api) ve sözleşme şemalarıyla doğrulanır.
import "server-only";
import {
  ArchiveDateSchema,
  ArchiveDayResponseSchema,
  ArchiveIndexResponseSchema,
  StatusResponseSchema,
  TopicDetailResponseSchema,
  TopicListResponseSchema,
  YoutubeListResponseSchema,
  isValidSlug,
  type ArchiveDayResponse,
  type ArchiveIndexResponse,
  type StatusResponse,
  type TopicDetailResponse,
  type TopicListResponse,
  type YoutubeListResponse,
} from "@gundemci/shared";
import { DataUnavailableError, apiGet } from "./api-client";

export { DataUnavailableError } from "./api-client";

const MAX_LIMIT = 50;
const clampLimit = (limit: number) => Math.min(Math.max(Math.trunc(limit) || 1, 1), MAX_LIMIT);

async function required<T>(promise: Promise<T | null>): Promise<T> {
  const result = await promise;
  // Liste uç noktaları 404 döndürmemeli; dönerse veri yok sayılır
  if (result === null) throw new DataUnavailableError("Beklenen veri bulunamadı");
  return result;
}

export async function getTopicList(
  options: { category?: string; limit?: number; kind?: "trend" | "news" } = {},
): Promise<TopicListResponse> {
  const params = new URLSearchParams({
    kind: options.kind ?? "trend",
    limit: String(clampLimit(options.limit ?? 20)),
  });
  if (options.category !== undefined) params.set("category", options.category);
  return required(apiGet(`/api/v1/topics?${params}`, TopicListResponseSchema));
}

export async function getRising(limit = 5): Promise<TopicListResponse> {
  return required(
    apiGet(`/api/v1/topics/rising?limit=${clampLimit(limit)}`, TopicListResponseSchema),
  );
}

export async function getFalling(limit = 5): Promise<TopicListResponse> {
  return required(
    apiGet(`/api/v1/topics/falling?limit=${clampLimit(limit)}`, TopicListResponseSchema),
  );
}

/** Bilinmeyen veya geçersiz konu → null (sayfa 404 gösterir) */
export async function getTopic(slug: string): Promise<TopicDetailResponse | null> {
  // Geçersiz slug API'ye hiç gönderilmez
  if (!isValidSlug(slug)) return null;
  return apiGet(`/api/v1/topics/${encodeURIComponent(slug)}`, TopicDetailResponseSchema);
}

export async function getStatus(): Promise<StatusResponse> {
  return required(apiGet("/api/v1/meta/status", StatusResponseSchema));
}

export async function getArchiveIndex(): Promise<ArchiveIndexResponse> {
  return required(apiGet("/api/v1/archive", ArchiveIndexResponseSchema));
}

/** Geçersiz veya kapsam dışı tarih → null (sayfa 404 gösterir) */
export async function getArchiveDay(date: string): Promise<ArchiveDayResponse | null> {
  if (!ArchiveDateSchema.safeParse(date).success) return null;
  return apiGet(`/api/v1/archive/${encodeURIComponent(date)}`, ArchiveDayResponseSchema);
}

/** YouTube Türkiye trend videoları (en güncel liste; 24 saatten eskiyse boş) */
export async function getYoutube(limit = 10): Promise<YoutubeListResponse> {
  return required(apiGet(`/api/v1/youtube?limit=${clampLimit(limit)}`, YoutubeListResponseSchema));
}
