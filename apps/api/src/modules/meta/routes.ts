import type { FastifyInstance } from "fastify";
import { CATEGORIES, CategoryListResponseSchema, StatusResponseSchema } from "@gundemci/shared";
import { sendError } from "../../lib/errors.ts";
import type { TopicRepository } from "../topics/repository.ts";
import type { TopicService } from "../topics/service.ts";

export async function metaRoutes(
  app: FastifyInstance,
  opts: { service: TopicService; repo: TopicRepository },
) {
  app.get("/categories", async (_req, reply) => {
    const body = CategoryListResponseSchema.parse({
      items: [...CATEGORIES]
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((c) => ({ slug: c.slug, name: c.name })),
    });
    return reply.header("cache-control", "public, max-age=3600").send(body);
  });

  app.get("/meta/status", async (_req, reply) => {
    const body = StatusResponseSchema.parse({
      providers: await opts.service.providerStatuses(),
      generatedAt: new Date().toISOString(),
    });
    return reply.header("cache-control", "public, max-age=30").send(body);
  });
}

/** Sağlık kontrolleri — iç ayrıntı (DB adı, sürüm, hata) vermez */
export async function healthRoutes(app: FastifyInstance, opts: { repo: TopicRepository }) {
  // Tarayıcıda yanlışlıkla API adresi açılırsa yol gösterir (sürüm/teknoloji bilgisi vermez)
  app.get("/", async (_req, reply) =>
    reply.header("cache-control", "no-store").send({
      service: "gündemci veri servisi (API)",
      message:
        "Bu adres sitenin arka planda kullandığı veri servisidir. Siteyi görmek için web adresini (yerelde http://localhost:3000) açın.",
    }),
  );

  app.get("/health", async (_req, reply) =>
    reply.header("cache-control", "no-store").send({ status: "ok" }),
  );

  app.get("/health/ready", async (req, reply) => {
    try {
      await opts.repo.ping();
      return reply.header("cache-control", "no-store").send({ status: "ok" });
    } catch (error) {
      req.log.error({ err: error }, "hazırlık kontrolü: veritabanına ulaşılamadı");
      return sendError(reply, "service_unavailable");
    }
  });
}
