// Toplanan haberlerden gündem konularını hemen bir kez üretir.
// Kullanım: pnpm topics:build
import { createDb } from "@gundemci/db";
import pino from "pino";
import { loadConfig } from "../config.ts";
import { buildTopics } from "../topics-pipeline/pipeline.ts";

const config = loadConfig();
const log = pino({ level: "error" });
const { db, client, close } = createDb(config.DATABASE_URL, { max: 3 });
try {
  const r = await buildTopics({ db, client, log });
  if (r.skipped) {
    console.log("Atlandı: başka bir süreç (ör. worker) şu an konuları güncelliyor.");
  } else {
    console.log(`Son 24 saatteki haber : ${r.itemsInWindow}`);
    console.log(`Oluşan grup           : ${r.clusters}`);
    console.log(`Yeni konu             : ${r.created}`);
    console.log(`Yayında               : ${r.published}`);
    console.log(`Soğuyan               : ${r.cooling}`);
    console.log(`Arşive düşen          : ${r.archived}`);
    console.log(`Skor kaydı (snapshot) : ${r.snapshots}`);
  }
} finally {
  await close();
}
