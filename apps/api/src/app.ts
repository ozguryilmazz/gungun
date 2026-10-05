import { randomUUID } from "node:crypto";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import Fastify, { type FastifyInstance } from "fastify";
import { errorBody, sendError } from "./lib/errors.ts";
import { archiveRoutes } from "./modules/archive/routes.ts";
import { healthRoutes, metaRoutes } from "./modules/meta/routes.ts";
import type { TopicRepository } from "./modules/topics/repository.ts";
import { topicRoutes } from "./modules/topics/routes.ts";
import { TopicService } from "./modules/topics/service.ts";
import { youtubeRoutes } from "./modules/youtube/routes.ts";

export interface AppOptions {
  repo: TopicRepository;
  cacheTtlSeconds: number;
  rateLimitMax: number;
  rateLimitAllowList?: string[];
  trustProxy?: boolean;
  logLevel?: string;
  /** Yalnızca testler için: sabit saat */
  clock?: () => Date;
}

export async function buildApp(opts: AppOptions): Promise<FastifyInstance> {
  const app = Fastify({
    trustProxy: opts.trustProxy ?? false,
    bodyLimit: 16 * 1024, // public API yalnızca GET; büyük gövde kabul edilmez
    genReqId: () => randomUUID(),
    // Uzun parametreler 414 yerine kendi doğrulamamıza ulaşsın (slug en fazla 160)
    routerOptions: { maxParamLength: 256 },
    requestIdHeader: false, // dışarıdan gelen kimlik kabul edilmez (log zehirleme)
    logger: {
      level: opts.logLevel ?? "info",
      // KVKK: IP, user-agent, çerez ve yetki başlıkları loglanmaz
      serializers: {
        req: (req) => ({ id: req.id, method: req.method, url: req.url }),
        res: (res) => ({ statusCode: res.statusCode }),
      },
      redact: [
        "req.headers.authorization",
        "req.headers.cookie",
        "headers.authorization",
        "headers.cookie",
      ],
    },
  });

  // Yanıtlara istek kimliği eklenir (destek/hata ayıklama için)
  app.addHook("onSend", async (req, reply) => {
    reply.header("x-request-id", req.id);
  });

  await app.register(helmet, {
    // JSON API: içerik çalıştırılmaz, en sıkı politika
    contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
    crossOriginResourcePolicy: { policy: "same-origin" },
  });

  await app.register(rateLimit, {
    global: true,
    max: opts.rateLimitMax,
    timeWindow: "1 minute",
    allowList: opts.rateLimitAllowList ?? [],
    errorResponseBuilder: (_req, context) => ({
      statusCode: context.statusCode,
      ...errorBody("rate_limited"),
    }),
  });

  // CORS kasıtlı olarak AÇILMADI: API'yi yalnızca web sunucusu sunucu tarafında çağırır;
  // tarayıcıdan farklı bir kökenden okunamaz.

  app.setNotFoundHandler((_req, reply) => sendError(reply, "not_found"));

  app.setErrorHandler((rawError, req, reply) => {
    const error = rawError as Error & { statusCode?: number; code?: string };
    const status = error.statusCode;
    if (status === 429)
      return reply.code(429).header("cache-control", "no-store").send(errorBody("rate_limited"));
    if (status !== undefined && status >= 400 && status < 500) {
      // Hatalı istek (bozuk JSON, büyük gövde vb.) — ayrıntı kullanıcıya verilmez
      req.log.info({ err: { message: error.message, code: error.code } }, "geçersiz istek");
      return sendError(reply, "invalid_request");
    }
    // Teknik ayrıntı YALNIZCA sunucu logunda
    req.log.error({ err: error }, "beklenmeyen hata");
    return sendError(reply, "internal_error");
  });

  const service = new TopicService(opts.repo, opts.cacheTtlSeconds, opts.clock);

  await app.register(healthRoutes, { repo: opts.repo });
  await app.register(
    async (v1) => {
      await v1.register(topicRoutes, { service });
      await v1.register(metaRoutes, { service, repo: opts.repo });
      await v1.register(archiveRoutes, { repo: opts.repo });
      await v1.register(youtubeRoutes, { repo: opts.repo, cacheTtlSeconds: opts.cacheTtlSeconds });
    },
    { prefix: "/api/v1" },
  );

  return app;
}
