import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  NewsStoryDetailResponseSchema,
  NewsStoryListResponseSchema,
  StoryIdSchema,
  type NewsStoryDetailResponse,
  type NewsStoryListResponse,
} from "@gundemci/shared";
import { TtlCache } from "../../lib/cache.ts";
import { sendError } from "../../lib/errors.ts";
import { STORY_RULES, describeSpread } from "../../topics-pipeline/stories.ts";
import type { TopicRepository } from "../topics/repository.ts";

const idParams = z.object({ id: z.string().max(32) });
const iso = (d: Date) => d.toISOString();

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
  const detailCache = new TtlCache<NewsStoryDetailResponse | null>(
    opts.cacheTtlSeconds * 1000,
    200,
  );

  /** Ortak haber detayı: ilk yayımlayan site, taramalara göre yayılma, hız ve tüm kaynaklar */
  app.get("/stories/:id", async (req, reply) => {
    const params = idParams.safeParse(req.params);
    // Geçersiz kimlik veritabanına hiç ulaşmaz
    if (!params.success || !StoryIdSchema.safeParse(params.data.id).success)
      return sendError(reply, "not_found");
    const id = Number(params.data.id);
    if (!Number.isSafeInteger(id)) return sendError(reply, "not_found");

    const body = await detailCache.getOrLoad(String(id), async () => {
      const found = await opts.repo.getStory(id);
      if (!found) return null;
      const now = clock();
      const spread = describeSpread(found.items, now);
      const site = (s: (typeof spread.sites)[number]) => ({
        name: s.name,
        title: s.title,
        url: s.url,
        publishedAt: iso(s.publishedAt),
        fetchedAt: iso(s.fetchedAt),
      });
      const { story } = found;
      return NewsStoryDetailResponseSchema.parse({
        story: {
          id: story.id,
          title: story.title,
          publisherCount: story.publisherCount,
          firstItemAt: iso(story.firstItemAt),
          listedAt: iso(story.listedAt),
          lastGrowthAt: story.lastGrowthAt ? iso(story.lastGrowthAt) : null,
          lastGrowthBy: story.lastGrowthBy,
        },
        sites: spread.sites.slice(0, 100).map(site),
        scans: spread.scans.slice(0, 200).map((s) => ({ at: iso(s.at), sites: s.sites })),
        spread: {
          minutesToThreeSites: spread.minutesToThreeSites,
          sitesInFirstHour: spread.sitesInFirstHour,
          sitesInLastHour: spread.sitesInLastHour,
          spanMinutes: spread.spanMinutes,
        },
        items: found.items.map((i) => site({ name: i.publisherName, ...i })),
        meta: { generatedAt: now.toISOString(), isMock: false },
      });
    });
    if (!body) return sendError(reply, "not_found");
    return reply.header("cache-control", "public, max-age=60").send(body);
  });

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
