import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { NewsStoryListResponseSchema, type NewsStoryListResponse } from "@gundemci/shared";
import { TtlCache } from "../../lib/cache.ts";
import { sendError } from "../../lib/errors.ts";
import { STORY_RULES } from "../../topics-pipeline/stories.ts";
import type { TopicRepository } from "../topics/repository.ts";

const query = z
  .object({ limit: z.coerce.number().int().min(1).max(STORY_RULES.maxListed).default(15) })
  .strict();

/** Ortak haberler: en az 3 haber sitesinde yayımlanan, son 24 saatin haberleri (site sayısına göre) */
export async function storyRoutes(
  app: FastifyInstance,
  opts: { repo: TopicRepository; cacheTtlSeconds: number; clock?: () => Date },
) {
  const clock = opts.clock ?? (() => new Date());
  const cache = new TtlCache<NewsStoryListResponse>(opts.cacheTtlSeconds * 1000, 20);

  app.get("/stories", async (req, reply) => {
    const q = query.safeParse(req.query);
    if (!q.success) return sendError(reply, "invalid_request");
    const { limit } = q.data;

    const body = await cache.getOrLoad(String(limit), async () => {
      const now = clock();
      const since = new Date(now.getTime() - STORY_RULES.windowHours * 3_600_000);
      const [rows, providers] = await Promise.all([
        opts.repo.listStories(since, limit),
        opts.repo.listProviders(),
      ]);
      const rss = providers.find((p) => p.key === "rss_news");
      return NewsStoryListResponseSchema.parse({
        items: rows.map((r) => ({
          id: r.id,
          title: r.title,
          publisherCount: r.publisherCount,
          firstItemAt: r.firstItemAt.toISOString(),
          listedAt: r.listedAt.toISOString(),
          lastGrowthAt: r.lastGrowthAt?.toISOString() ?? null,
          lastGrowthBy: r.lastGrowthBy,
          sources: r.sources.map((s) => ({
            name: s.publisherName,
            url: s.url,
            publishedAt: s.publishedAt.toISOString(),
          })),
        })),
        scannedAt: rss?.lastSuccessAt?.toISOString() ?? null,
        meta: { generatedAt: now.toISOString(), isMock: false },
      });
    });
    return reply.header("cache-control", "public, max-age=60").send(body);
  });
}
