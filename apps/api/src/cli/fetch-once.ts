// Bir veri sağlayıcısını HEMEN, bir kez çalıştırır (kapalı olsa bile) ve kaynak bazında sonucu yazdırır.
// Kullanım: pnpm fetch:once rss_news | google_trends | gdelt_news | youtube_trending | all
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
    const result = await runProvider(
      { db, client, log, secrets: { youtubeApiKey: config.YOUTUBE_API_KEY } },
      key,
      { force: true },
    );
    if (result.skipped) {
      console.log(
        `  atlandı: ${result.skipped === "locked" ? "başka bir süreç şu an çalıştırıyor" : result.skipped}`,
      );
      continue;
    }
    for (const d of result.details) {
      if (!d.ok) {
        console.log(`  ✖ ${d.name.padEnd(22)} ${d.error}`);
        continue;
      }
      const notes: string[] = [];
      if (d.matched !== undefined) {
        notes.push(`kaynaktan ${d.parsed ?? 0} haber, başlığında terim geçen ${d.matched}`);
      } else if (d.parsed !== undefined) notes.push(`akışta ${d.parsed} öğe`);
      if (d.offDomain) {
        notes.push(`${d.offDomain} başka alan adına gidiyor (${d.offDomainHosts?.join(", ")})`);
      }
      // Akış boşsa veya tüm bağlantılar başka alan adına gidiyorsa uyarı (aramada 0 sonuç olağandır)
      const warn =
        d.matched === undefined &&
        (d.parsed === 0 || (d.parsed !== undefined && d.offDomain === d.parsed));
      const suffix = notes.length ? ` — ${notes.join(", ")}` : "";
      console.log(`  ${warn ? "⚠" : "✔"} ${d.name.padEnd(22)} ${d.items} yeni kayıt${suffix}`);
    }
    console.log(`  → durum: ${result.status}, toplam yeni kayıt: ${result.itemsFetched}`);
    if (result.status === "failed") failed = true;
  }
} finally {
  await close();
}
process.exitCode = failed ? 1 : 0;
