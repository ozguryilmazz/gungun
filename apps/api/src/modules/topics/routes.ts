import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  TopicDetailResponseSchema,
  TopicHistoryResponseSchema,
  TopicListResponseSchema,
  findCategory,
  isValidSlug,
  type TopicSummary,
} from "@gundemci/shared";
import { sendError } from "../../lib/errors.ts";
import { selectFalling, selectRising, type TopicService } from "./service.ts";

const MAX_LIMIT = 50;

// Bilinmeyen sorgu parametreleri reddedilir (strict)
const listQuery = z
  .object({
    kind: z.enum(["trend", "news"]).default("trend"),
    category: z
      .string()
      .regex(/^[a-z]{2,32}$/)
      .optional(),
    limit: z.coerce.number().int().min(1).max(MAX_LIMIT).default(20),
  })
  .strict();

const movementQuery = z
  .object({ limit: z.coerce.number().int().min(1).max(MAX_LIMIT).default(5) })
  .strict();

const slugParams = z.object({ slug: z.string().max(160) });

const CACHE_HEADER = "public, max-age=30, stale-while-revalidate=60";

function listBody(items: TopicSummary[], generatedAt: Date) {
  return TopicListResponseSchema.parse({
    items,
    meta: { generatedAt: generatedAt.toISOString(), isMock: items.some((t) => t.isMock) },
  });
}

export async function topicRoutes(app: FastifyInstance, opts: { service: TopicService }) {
  const { service } = opts;

  app.get("/topics", async (req, reply) => {
    const query = listQuery.safeParse(req.query);
    if (!query.success) return sendError(reply, "invalid_request");
    const { kind, category, limit } = query.data;
    if (category !== undefined && !findCategory(category)) return sendError(reply, "not_found");

    const { items, generatedAt } = await service.ranked(kind);
    const filtered =
      category === undefined ? items : items.filter((t) => t.category.slug === category);
    return reply
      .header("cache-control", CACHE_HEADER)
      .send(listBody(filtered.slice(0, limit), generatedAt));
  });

  app.get("/topics/rising", async (req, reply) => {
    const query = movementQuery.safeParse(req.query);
    if (!query.success) return sendError(reply, "invalid_request");
    const { items, generatedAt } = await service.ranked();
    return reply
      .header("cache-control", CACHE_HEADER)
      .send(listBody(selectRising(items, query.data.limit), generatedAt));
  });

  app.get("/topics/falling", async (req, reply) => {
    const query = movementQuery.safeParse(req.query);
    if (!query.success) return sendError(reply, "invalid_request");
    const { items, generatedAt } = await service.ranked();
    return reply
      .header("cache-control", CACHE_HEADER)
      .send(listBody(selectFalling(items, query.data.limit), generatedAt));
  });

  app.get("/topics/:slug", async (req, reply) => {
    const params = slugParams.safeParse(req.params);
    // Geçersiz slug veritabanına hiç ulaşmaz
    if (!params.success || !isValidSlug(params.data.slug)) return sendError(reply, "not_found");
    const item = await service.getDetail(params.data.slug);
    if (!item) return sendError(reply, "not_found");
    return reply.header("cache-control", CACHE_HEADER).send(
      TopicDetailResponseSchema.parse({
        item,
        meta: { generatedAt: new Date().toISOString(), isMock: item.isMock },
      }),
    );
  });

  app.get("/topics/:slug/history", async (req, reply) => {
    const params = slugParams.safeParse(req.params);
    if (!params.success || !isValidSlug(params.data.slug)) return sendError(reply, "not_found");
    const history = await service.getHistory(params.data.slug);
    if (!history) return sendError(reply, "not_found");
    const detail = await service.getDetail(params.data.slug);
    return reply.header("cache-control", CACHE_HEADER).send(
      TopicHistoryResponseSchema.parse({
        items: history.map((h) => ({ capturedAt: h.capturedAt.toISOString(), score: h.score })),
        meta: { generatedAt: new Date().toISOString(), isMock: detail?.isMock ?? false },
      }),
    );
  });
}
