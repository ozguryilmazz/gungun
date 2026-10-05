import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseEnv } from "node:util";
import type { NextConfig } from "next";

// Kök dizindeki ortak .env'den YALNIZCA web sunucusunun ihtiyaç duyduğu sunucu tarafı
// değişkenleri alınır. NEXT_PUBLIC_ önekli değişken yok: hiçbir ayar tarayıcıya gönderilmez.
const SERVER_ENV_KEYS = ["API_INTERNAL_URL"] as const;
const rootEnvPath = resolve(process.cwd(), "../../.env");
if (existsSync(rootEnvPath)) {
  const parsed = parseEnv(readFileSync(rootEnvPath, "utf8"));
  for (const key of SERVER_ENV_KEYS) {
    if (process.env[key] === undefined && parsed[key] !== undefined) process.env[key] = parsed[key];
  }
}

const isDev = process.env.NODE_ENV !== "production";

// Temel Content-Security-Policy. Nonce tabanlı sıkı CSP aşama 10'da (güvenlik sertleştirme).
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https://i.ytimg.com",
  "font-src 'self'",
  `connect-src 'self'${isDev ? " ws:" : ""}`,
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), browsing-topics=()",
  },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  // Ortak paket TypeScript kaynağı olarak gelir
  transpilePackages: ["@gundemci/shared"],
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
