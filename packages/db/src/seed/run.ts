// CLI: pnpm db:seed
import { createDb } from "../client.js";
import { loadDbEnv } from "../env.js";
import { seedDatabase } from "./index.js";

try {
  const env = loadDbEnv();
  if (env.NODE_ENV === "production" && env.USE_MOCK_DATA) {
    throw new Error("Production ortamında örnek veri yüklenemez (USE_MOCK_DATA=true).");
  }

  const { db, close } = createDb(env.DATABASE_URL, { max: 1 });
  try {
    const result = await seedDatabase(db, { includeMock: env.USE_MOCK_DATA });
    console.log(
      `✔ Seed tamamlandı: ${result.categories} kategori, ${result.providers} veri sağlayıcı, ` +
        `${result.publishers} yayıncı.`,
    );
    console.log(
      env.USE_MOCK_DATA
        ? `⚠ ${result.mockTopics} ÖRNEK konu yüklendi (is_mock=true, gerçek veri DEĞİL).`
        : "Örnek veri yüklenmedi; varsa eski örnek veriler silindi (USE_MOCK_DATA=false).",
    );
  } finally {
    await close();
  }
} catch (error) {
  console.error("✖ Seed başarısız:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
