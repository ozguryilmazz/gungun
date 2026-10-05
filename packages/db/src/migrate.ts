// CLI: pnpm db:migrate
import { loadDbEnv } from "./env.js";
import { runMigrations } from "./migrator.js";

try {
  const env = loadDbEnv();
  await runMigrations(env.DATABASE_URL);
  console.log("✔ Migration'lar uygulandı.");
} catch (error) {
  console.error("✖ Migration başarısız:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
