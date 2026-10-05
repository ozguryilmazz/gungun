// API giriş noktası: pnpm --filter @gundemci/api dev
import { createDb } from "@gundemci/db";
import { buildApp } from "./app.ts";
import { loadConfig } from "./config.ts";
import { createTopicRepository } from "./modules/topics/repository.ts";

let config;
try {
  config = loadConfig();
} catch (error) {
  console.error("✖ API başlatılamadı:", error instanceof Error ? error.message : error);
  process.exit(1);
}

const { db, close } = createDb(config.DATABASE_URL);
const app = await buildApp({
  repo: createTopicRepository(db),
  cacheTtlSeconds: config.CACHE_TTL_SECONDS,
  rateLimitMax: config.RATE_LIMIT_MAX,
  rateLimitAllowList: config.RATE_LIMIT_ALLOWLIST,
  trustProxy: config.TRUST_PROXY,
  logLevel: config.LOG_LEVEL,
});

const shutdown = async (signal: string) => {
  app.log.info(`${signal} alındı, kapatılıyor`);
  await app.close();
  await close();
  process.exit(0);
};
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

try {
  await app.listen({ host: config.API_HOST, port: config.API_PORT });
} catch (error) {
  app.log.error({ err: error }, "API dinlemeye başlayamadı");
  await close();
  process.exit(1);
}
