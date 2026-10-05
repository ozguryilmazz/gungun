import type { TopicSummary } from "@gundemci/shared";

/** Listenin sıra + skor imzası: değiştiyse sayfa yenilenir */
export function listSignature(items: Pick<TopicSummary, "slug" | "score">[]): string {
  return items.map((t) => `${t.slug}:${t.score ?? "-"}`).join("|");
}

/** Mevcut listede olmayan (yeni giren) konular */
export function newSlugs(current: string[], fetched: string[]): string[] {
  const known = new Set(current);
  return fetched.filter((s) => !known.has(s));
}
