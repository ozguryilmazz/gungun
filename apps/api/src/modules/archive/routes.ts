import type { FastifyInstance } from "fastify";
import {
  ArchiveDateSchema,
  ArchiveDayResponseSchema,
  ArchiveIndexResponseSchema,
} from "@gundemci/shared";
import { sendError } from "../../lib/errors.ts";
import type { TopicRepository } from "../topics/repository.ts";

/** Türkiye 2016'dan beri yıl boyu UTC+3 */
const ISTANBUL_OFFSET_MS = 3 * 3_600_000;
const EARLIEST = "2026-01-01";

/** İstanbul takvim gününün UTC başlangıç/bitişi */
export function istanbulDayRange(date: string): { start: Date; end: Date } {
  const midnightUtc = Date.parse(`${date}T00:00:00Z`);
  const start = new Date(midnightUtc - ISTANBUL_OFFSET_MS);
  return { start, end: new Date(start.getTime() + 86_400_000) };
}

export function istanbulToday(now = new Date()): string {
  return new Date(now.getTime() + ISTANBUL_OFFSET_MS).toISOString().slice(0, 10);
}

export async function archiveRoutes(app: FastifyInstance, opts: { repo: TopicRepository }) {
  app.get("/archive", async (_req, reply) => {
    const days = await opts.repo.archiveDays(60);
    return reply
      .header("cache-control", "public, max-age=300")
      .send(ArchiveIndexResponseSchema.parse({ days }));
  });

  app.get("/archive/:date", async (req, reply) => {
    const raw = (req.params as { date?: unknown }).date;
    const parsed = ArchiveDateSchema.safeParse(raw);
    // Geçersiz, çok eski veya gelecekteki tarih veritabanına ulaşmaz
    if (!parsed.success || parsed.data < EARLIEST || parsed.data > istanbulToday()) {
      return sendError(reply, "not_found");
    }
    const { start, end } = istanbulDayRange(parsed.data);
    const rows = await opts.repo.archiveDay(start, end);
    const body = ArchiveDayResponseSchema.parse({
      date: parsed.data,
      items: rows.map((r, i) => ({
        slug: r.slug,
        title: r.title,
        category: { slug: r.categorySlug, name: r.categoryName },
        peakScore: r.peakScore,
        rank: i + 1,
        firstSeenAt: r.firstSeenAt.toISOString(),
        sourceCount: r.sourceCount,
        isMock: r.isMock,
      })),
      meta: { generatedAt: new Date().toISOString(), isMock: rows.some((r) => r.isMock) },
    });
    // Geçmiş günler değişmez; bugünkü sayfa kısa süre önbellekte tutulur
    const isToday = parsed.data === istanbulToday();
    return reply
      .header("cache-control", isToday ? "public, max-age=60" : "public, max-age=3600")
      .send(body);
  });
}
