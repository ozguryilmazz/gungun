import { existsSync } from "node:fs";
import { isIP } from "node:net";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const ROOT_ENV_PATH = fileURLToPath(new URL("../../../.env", import.meta.url));

const configSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "staging", "production"]).default("development"),
  DATABASE_URL: z
    .string({ error: "tanımlı değil — kök dizinde .env dosyası var mı? (copy .env.example .env)" })
    .refine((v) => v.startsWith("postgres://") || v.startsWith("postgresql://"), {
      message: "postgres:// veya postgresql:// ile başlamalı",
    }),
  // Varsayılan olarak yalnızca bu bilgisayardan erişilebilir
  API_HOST: z.string().default("127.0.0.1"),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  CACHE_TTL_SECONDS: z.coerce.number().int().min(0).max(3600).default(30),
  RATE_LIMIT_MAX: z.coerce.number().int().min(1).max(100_000).default(120),
  // Rate limit'ten muaf tutulacak IP'ler (örn. API'yi sunucu tarafında çağıran web sunucusu)
  // Varsayılan: aynı bilgisayardaki web sunucusu (API'yi sunucu tarafında çağırır)
  RATE_LIMIT_ALLOWLIST: z
    .string()
    .default("127.0.0.1,::1")
    .transform((v) =>
      v
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    )
    .refine((ips) => ips.every((ip) => isIP(ip) !== 0), { message: "geçersiz IP adresi" }),
  // Reverse proxy arkasında çalışırken true yapılmalı (aşama 14)
  TRUST_PROXY: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
});

export type ApiConfig = z.infer<typeof configSchema>;

/** Ortam değişkenlerini doğrular; hatada değişken adını söyler, DEĞERİNİ yazdırmaz. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  if (env === process.env && existsSync(ROOT_ENV_PATH)) {
    process.loadEnvFile(ROOT_ENV_PATH);
  }
  const parsed = configSchema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Geçersiz ortam değişkenleri:\n${problems}`);
  }
  return parsed.data;
}
