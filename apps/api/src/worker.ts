// Veri toplama süreci: pnpm worker
// Yalnızca AÇIK (is_enabled) sağlayıcıları, aralıklarına göre çalıştırır. API'den ayrı süreçtir;
// veri çekme yavaşlasa da kullanıcıya açık API etkilenmez.
import { createDb } from "@gundemci/db";
import pino from "pino";
import { loadConfig } from "./config.ts";
import { tick } from "./ingest/scheduler.ts";
import { buildTopics } from "./topics-pipeline/pipeline.ts";

const TICK_MS = 60_000;
/** Yeni veri gelmese de skorlar/yaşam döngüsü bu aralıkla güncellenir */
const BUILD_EVERY_MS = 10 * 60_000;

let config;
try {
  config = loadConfig();
} catch (error) {
  console.error("✖ Worker başlatılamadı:", error instanceof Error ? error.message : error);
  process.exit(1);
}

const log = pino({ level: config.LOG_LEVEL, base: { proc: "worker" } });
const { db, client, close } = createDb(config.DATABASE_URL, { max: 3 });

let stopping = false;
let timer: NodeJS.Timeout | undefined;
let running: Promise<void> = Promise.resolve();
let lastBuild = 0;

/** Veri çek; yeni veri geldiyse veya süre dolduysa gündem konularını güncelle */
async function cycle() {
  const newItems = await tick({ db, client, log });
  if (newItems > 0 || Date.now() - lastBuild >= BUILD_EVERY_MS) {
    await buildTopics({ db, client, log });
    lastBuild = Date.now();
  }
}

async function loop() {
  if (stopping) return;
  running = cycle().catch((error: unknown) => log.error({ err: error }, "zamanlayıcı hatası"));
  await running;
  if (!stopping) timer = setTimeout(loop, TICK_MS);
}

async function shutdown(signal: string) {
  stopping = true;
  if (timer) clearTimeout(timer);
  log.info(`${signal} alındı; süren çalışma bitince kapanacak`);
  await running;
  await close();
  process.exit(0);
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

log.info("worker başladı — yalnızca açık veri sağlayıcıları çalıştırılır (pnpm providers list)");
void loop();
