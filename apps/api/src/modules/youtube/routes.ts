import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { YoutubeListResponseSchema, type YoutubeListResponse } from "@gundemci/shared";
import { TtlCache } from "../../lib/cache.ts";
import { sendError } from "../../lib/errors.ts";
import type { TopicRepository } from "../topics/repository.ts";

/** Bundan eski liste gösterilmez (güncel olmayan veri "trend" diye sunulmaz) */
export const YOUTUBE_MAX_AGE_HOURS = 24;

const query = z.object({ limit: z.coerce.number().int().min(1).max(50).default(10) }).strict();

export async function youtubeRoutes(
  app: FastifyInstance,
  opts: { repo: TopicRepository; cacheTtlSeconds: number; clock?: () => Date },
) {
  const clock = opts.clock ?? (() => new Date());
  const cache = new TtlCache<YoutubeListResponse>(opts.cacheTtlSeconds * 1000, 50);

  app.get("/youtube", async (req, reply) => {
    const q = query.safeParse(req.query);
    if (!q.success) return sendError(reply, "invalid_request");
    const { limit } = q.data;

    const body = await cache.getOrLoad(String(limit), async () => {
      const now = clock();
      const since = new Date(now.getTime() - YOUTUBE_MAX_AGE_HOURS * 3_600_000);
      const rows = await opts.repo.latestYoutube(since, limit);
      return YoutubeListResponseSchema.parse({
        items: rows.map((r) => ({
          rank: r.rank,
          videoId: r.videoId,
          title: r.title,
          channelTitle: r.channelTitle,
          url: `https://www.youtube.com/watch?v=${encodeURIComponent(r.videoId)}`,
          thumbnailUrl: r.thumbnailUrl,
          viewCount: r.viewCount,
          publishedAt: r.publishedAt?.toISOString() ?? null,
        })),
        observedAt: rows[0]?.observedAt.toISOString() ?? null,
        meta: { generatedAt: now.toISOString(), isMock: false },
      });
    });
    return reply.header("cache-control", "public, max-age=60").send(body);
  });
}
