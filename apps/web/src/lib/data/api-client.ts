// Backend API istemcisi. YALNIZCA sunucuda çalışır: API adresi ve olası anahtarlar
// tarayıcıya hiçbir zaman gönderilmez; tarayıcı üçüncü taraf veya backend'e doğrudan bağlanmaz.
import "server-only";
import type { z } from "zod";

const DEFAULT_API_URL = "http://127.0.0.1:4000";
const TIMEOUT_MS = 5_000;
const REVALIDATE_SECONDS = 30;

/** Veri alınamadı (ağ, zaman aşımı, 5xx, sözleşmeye uymayan yanıt). Ayrıntı yalnızca logda. */
export class DataUnavailableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "DataUnavailableError";
  }
}

let cachedBase: URL | undefined;

/** API adresi ortam değişkeninden gelir; yalnızca http(s) ve kimlik bilgisi içermeyen adres kabul edilir */
export function apiBaseUrl(): URL {
  if (cachedBase) return cachedBase;
  const raw = process.env.API_INTERNAL_URL?.trim() || DEFAULT_API_URL;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("API_INTERNAL_URL geçerli bir adres değil");
  }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw new Error("API_INTERNAL_URL yalnızca kimlik bilgisi içermeyen http(s) adresi olabilir");
  }
  cachedBase = url;
  return url;
}

/**
 * API'den GET ile JSON alır ve şemayla DOĞRULAR. 404 → null.
 * `path` her zaman kod içinde sabit + encodeURIComponent ile kurulur (kullanıcı girdisi adres değiştiremez).
 */
export async function apiGet<T>(path: string, schema: z.ZodType<T>): Promise<T | null> {
  const url = new URL(path, apiBaseUrl());
  if (url.origin !== apiBaseUrl().origin) throw new Error("API dışına istek engellendi");

  const first = await fetchJson(url, "cached");
  if (first === null) return null;
  let parsed = schema.safeParse(first);
  if (!parsed.success) {
    // Önbellekteki yanıt eski sürümden kalmış olabilir (ör. güncelleme sonrası yeni alanlar yok):
    // önbelleği atlayıp bir kez daha doğrudan API'den istenir
    const fresh = await fetchJson(url, "no-store");
    if (fresh === null) return null;
    parsed = schema.safeParse(fresh);
  }
  if (!parsed.success) {
    console.error(
      `[api] ${url.pathname} yanıtı sözleşmeye uymuyor`,
      parsed.error.issues.slice(0, 5),
    );
    throw new DataUnavailableError("API yanıtı sözleşmeye uymuyor");
  }
  return parsed.data;
}

/** Tek istek: 404 → null; ağ hatası, 5xx ve JSON olmayan yanıt → DataUnavailableError */
async function fetchJson(url: URL, mode: "cached" | "no-store"): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      redirect: "error",
      ...(mode === "cached"
        ? { next: { revalidate: REVALIDATE_SECONDS } }
        : { cache: "no-store" as const }),
    });
  } catch (error) {
    console.error(`[api] ${url.pathname} isteği başarısız`, error);
    throw new DataUnavailableError("API'ye ulaşılamadı", { cause: error });
  }

  if (response.status === 404) return null;
  if (!response.ok) {
    console.error(`[api] ${url.pathname} → HTTP ${response.status}`);
    throw new DataUnavailableError(`API HTTP ${response.status}`);
  }
  try {
    return await response.json();
  } catch (error) {
    throw new DataUnavailableError("API yanıtı JSON değil", { cause: error });
  }
}
