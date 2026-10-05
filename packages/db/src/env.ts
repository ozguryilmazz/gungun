import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { z } from "zod";

// Kök dizindeki .env dosyası (packages/db/src → ../../../.env)
const ROOT_ENV_PATH = fileURLToPath(new URL("../../../.env", import.meta.url));

const booleanString = z
  .enum(["true", "false"])
  .default("false")
  .transform((value) => value === "true");

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "staging", "production"]).default("development"),
  DATABASE_URL: z
    .string({ error: "tanımlı değil — kök dizinde .env dosyası var mı? (copy .env.example .env)" })
    .min(1, "boş olamaz")
    .refine(
      (value) => value.startsWith("postgres://") || value.startsWith("postgresql://"),
      "DATABASE_URL postgres:// veya postgresql:// ile başlamalı",
    ),
  USE_MOCK_DATA: booleanString,
});

export type DbEnv = z.infer<typeof envSchema>;

/**
 * Ortam değişkenlerini okur ve doğrular. Geçersizse hangi değişkenin hatalı olduğunu
 * söyler ama değerini asla yazdırmaz (şifre sızıntısını önlemek için).
 */
export function loadDbEnv(): DbEnv {
  if (existsSync(ROOT_ENV_PATH)) {
    // Zaten tanımlı ortam değişkenlerinin üzerine yazmaz
    process.loadEnvFile(ROOT_ENV_PATH);
  }

  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`Geçersiz ortam değişkenleri:\n${problems}`);
  }
  return parsed.data;
}
