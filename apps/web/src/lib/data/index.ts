// Arayüzün tek veri erişim noktası. Yalnızca sunucuda çalışır; tarayıcıya gönderilmez.
// Aşama 6'da bu fonksiyonların içi backend API çağrısına çevrilecek, imzaları aynı kalacak.
import "server-only";
import {
  RISING_MIN_SOURCES,
  TopicDetailResponseSchema,
  TopicListResponseSchema,
  findCategory,
  isValidSlug,
  type TopicDetail,
  type TopicDetailResponse,
  type TopicListResponse,
  type TopicSummary,
} from "@gundemci/shared";
import { buildMockTopics } from "./mock-source";

const MAX_LIMIT = 50;

function toSummary(detail: TopicDetail): TopicSummary {
  return {
    slug: detail.slug,
    title: detail.title,
    category: detail.category,
    rank: detail.rank,
    score: detail.score,
    previousScore: detail.previousScore,
    changePct: detail.changePct,
    trend: detail.trend,
    signalsAvailable: detail.signalsAvailable,
    signalsTotal: detail.signalsTotal,
    sourceCount: detail.sourceCount,
    summary: detail.summary,
    updatedAt: detail.updatedAt,
    isMock: detail.isMock,
  };
}

function listResponse(items: TopicDetail[], now: Date): TopicListResponse {
  // Sözleşme doğrulaması: kaynak ne olursa olsun arayüze yalnızca geçerli veri ulaşır
  return TopicListResponseSchema.parse({
    items: items.map(toSummary),
    meta: { generatedAt: now.toISOString(), isMock: true },
  });
}

const clampLimit = (limit: number) => Math.min(Math.max(Math.trunc(limit), 1), MAX_LIMIT);

export async function getTopicList(
  options: { category?: string; limit?: number } = {},
): Promise<TopicListResponse> {
  const now = new Date();
  let topics = buildMockTopics(now);
  if (options.category !== undefined) {
    topics = topics.filter((t) => t.category.slug === options.category);
  }
  return listResponse(topics.slice(0, clampLimit(options.limit ?? 20)), now);
}

/** Son penceredeki en hızlı yükselenler; az kaynaklı konular elenir */
export async function getRising(limit = 5): Promise<TopicListResponse> {
  const now = new Date();
  const topics = buildMockTopics(now)
    .filter((t) => (t.trend === "surging" || t.trend === "rising") && t.changePct !== null)
    .filter((t) => t.sourceCount >= RISING_MIN_SOURCES)
    .sort((a, b) => (b.changePct ?? 0) - (a.changePct ?? 0));
  return listResponse(topics.slice(0, clampLimit(limit)), now);
}

export async function getFalling(limit = 5): Promise<TopicListResponse> {
  const now = new Date();
  const topics = buildMockTopics(now)
    .filter((t) => t.trend === "falling")
    .sort((a, b) => (a.changePct ?? 0) - (b.changePct ?? 0));
  return listResponse(topics.slice(0, clampLimit(limit)), now);
}

export async function getTopic(slug: string): Promise<TopicDetailResponse | null> {
  // Geçersiz slug veri katmanına hiç ulaşmaz
  if (!isValidSlug(slug)) return null;
  const now = new Date();
  const topic = buildMockTopics(now).find((t) => t.slug === slug);
  if (!topic) return null;
  return TopicDetailResponseSchema.parse({
    item: topic,
    meta: { generatedAt: now.toISOString(), isMock: true },
  });
}

export function getCategory(slug: string) {
  return findCategory(slug);
}
