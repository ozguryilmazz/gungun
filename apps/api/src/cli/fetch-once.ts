// Bir veri sağlayıcısını HEMEN, bir kez çalıştırır (kapalı olsa bile) ve kaynak bazında sonucu yazdırır.
// Kullanım: pnpm fetch:once rss_news | google_trends | all
import { createDb } from "@gundemci/db";
import pino from "pino";
import { loadConfig } from "../config.ts";
import { PROVIDERS, runProvider } from "../ingest/runner.ts";

const arg = process.argv[2] ?? "all";
const keys = arg === "all" ? Object.keys(PROVIDERS) : [arg];
if (keys.some((k) => !PROVIDERS[k])) {
  console.error(
    `Bilinmeyen sağlayıcı: ${arg}. Seçenekler: ${Object.keys(PROVIDERS).join(", ")}, all`,
  );
  process.exit(1);
}

const config = loadConfig();
// Kaynak bazında sonuç aşağıda yazdırılır; ayrıntılı uyarılar yalnızca LOG_LEVEL=debug ile
const log = pino({ level: config.LOG_LEVEL === "debug" ? "debug" : "error" });
const { db, client, close } = createDb(config.DATABASE_URL, { max: 3 });

let failed = false;
try {
  for (const key of keys) {
    console.log(`\n▶ ${key}`);
    const result = await runProvider({ db, client, log }, key, { force: true });
    if (result.skipped) {
      console.log(
        `  atlandı: ${result.skipped === "locked" ? "başka bir süreç şu an çalıştırıyor" : result.skipped}`,
      );
      continue;
    }
    for (const d of result.details) {
      console.log(
        `  ${d.ok ? "✔" : "✖"} ${d.name.padEnd(22)} ${d.ok ? `${d.items} yeni kayıt` : d.error}`,
      );
    }
    console.log(`  → durum: ${result.status}, toplam yeni kayıt: ${result.itemsFetched}`);
    if (result.status === "failed") failed = true;
  }
} finally {
  await close();
}
process.exitCode = failed ? 1 : 0;
