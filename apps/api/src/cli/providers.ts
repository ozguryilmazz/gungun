// Veri sağlayıcılarını listeler / açar / kapatır.
// Kullanım: pnpm providers list | pnpm providers enable rss_news | pnpm providers disable rss_news
import { createDb, dataProviders } from "@gundemci/db";
import { asc, eq } from "drizzle-orm";
import { loadConfig } from "../config.ts";
import { PROVIDERS } from "../ingest/runner.ts";

const [command = "list", key] = process.argv.slice(2);
const config = loadConfig();
const { db, close } = createDb(config.DATABASE_URL, { max: 1 });

try {
  if (command === "enable" || command === "disable") {
    if (!key || !PROVIDERS[key]) {
      console.error(`Sağlayıcı belirtin: ${Object.keys(PROVIDERS).join(", ")}`);
      process.exitCode = 1;
    } else {
      const updated = await db
        .update(dataProviders)
        .set({ isEnabled: command === "enable" })
        .where(eq(dataProviders.key, key))
        .returning({ key: dataProviders.key });
      console.log(
        updated.length
          ? `✔ ${key} ${command === "enable" ? "açıldı" : "kapatıldı"}`
          : `✖ ${key} veritabanında yok (pnpm db:seed?)`,
      );
    }
  } else {
    const rows = await db.select().from(dataProviders).orderBy(asc(dataProviders.id));
    for (const r of rows.filter((r) => r.kind !== "manual")) {
      const last = r.lastSuccessAt ? r.lastSuccessAt.toISOString() : "—";
      console.log(
        `${r.isEnabled ? "● açık  " : "○ kapalı"}  ${r.key.padEnd(14)} son başarı: ${last}  ardışık hata: ${r.consecutiveFailures}`,
      );
    }
  }
} finally {
  await close();
}
