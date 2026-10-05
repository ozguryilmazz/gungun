// Bir veri sağlayıcısını güvenle çalıştırır: aynı anda tek çalışma (PostgreSQL advisory lock),
// her çalışma fetch_runs'a kaydedilir, sağlayıcı durumu güncellenir. ASLA hata fırlatmaz:
// bir kaynağın çökmesi diğerlerini ve sistemi etkilemez.
import { eq, sql } from "drizzle-orm";
import { dataProviders, fetchRuns, type Database } from "@gundemci/db";
import type postgres from "postgres";
import { safeFetch } from "../lib/safe-http.ts";
import { googleNewsSearchProvider } from "./providers/google-news-search.ts";
import { googleTrendsProvider } from "./providers/google-trends.ts";
import { rssNewsProvider } from "./providers/rss-news.ts";
import { youtubeTrendingProvider } from "./providers/youtube-trending.ts";
import type {
  Fetcher,
  IngestProvider,
  Logger,
  ProviderOutcome,
  ProviderRecord,
  ProviderSecrets,
} from "./types.ts";

export const PROVIDERS: Record<string, IngestProvider> = {
  [rssNewsProvider.key]: rssNewsProvider,
  [googleTrendsProvider.key]: googleTrendsProvider,
  [googleNewsSearchProvider.key]: googleNewsSearchProvider,
  [youtubeTrendingProvider.key]: youtubeTrendingProvider,
};

export interface RunResult extends ProviderOutcome {
  provider: string;
  skipped?: "disabled" | "locked" | "unknown";
}

export interface RunnerDeps {
  db: Database;
  client: postgres.Sql;
  log: Logger;
  fetcher?: Fetcher;
  now?: () => Date;
  secrets?: ProviderSecrets;
}

export async function loadProvider(db: Database, key: string): Promise<ProviderRecord | null> {
  const [row] = await db
    .select({
      id: dataProviders.id,
      key: dataProviders.key,
      name: dataProviders.name,
      isEnabled: dataProviders.isEnabled,
      config: dataProviders.config,
      consecutiveFailures: dataProviders.consecutiveFailures,
    })
    .from(dataProviders)
    .where(eq(dataProviders.key, key));
  return row ?? null;
}

export async function runProvider(
  deps: RunnerDeps,
  key: string,
  options: { force?: boolean } = {},
): Promise<RunResult> {
  const empty = { itemsFetched: 0, details: [] };
  const impl = PROVIDERS[key];
  const record = impl ? await loadProvider(deps.db, key) : null;
  if (!impl || !record) return { provider: key, status: "failed", ...empty, skipped: "unknown" };
  if (!record.isEnabled && !options.force)
    return { provider: key, status: "failed", ...empty, skipped: "disabled" };

  // Aynı sağlayıcı iki süreçte aynı anda çalışmasın
  const conn = await deps.client.reserve();
  try {
    const [lock] = await conn`select pg_try_advisory_lock(hashtext(${`ingest:${key}`})) as ok`;
    if (!lock?.ok) return { provider: key, status: "failed", ...empty, skipped: "locked" };

    const now = deps.now?.() ?? new Date();
    const [run] = await deps.db
      .insert(fetchRuns)
      .values({ providerId: record.id, startedAt: now })
      .returning({ id: fetchRuns.id });

    let outcome: ProviderOutcome;
    try {
      outcome = await impl.run({
        db: deps.db,
        provider: record,
        now,
        fetcher: deps.fetcher ?? safeFetch,
        log: deps.log,
        secrets: deps.secrets ?? {},
      });
    } catch (error) {
      deps.log.error({ err: error, provider: key }, "sağlayıcı beklenmeyen hata verdi");
      outcome = {
        status: "failed",
        ...empty,
        errorCode: "unexpected",
        errorMessage: "Beklenmeyen hata",
      };
    }

    const finishedAt = new Date();
    await deps.db
      .update(fetchRuns)
      .set({
        finishedAt,
        status: outcome.status,
        itemsFetched: outcome.itemsFetched,
        errorCode: outcome.errorCode ?? null,
        errorMessage: outcome.errorMessage?.slice(0, 500) ?? null,
        details: outcome.details,
      })
      .where(eq(fetchRuns.id, run!.id));

    // Kısmi başarı da başarıdır: en az bir kaynak çalıştı
    await deps.db
      .update(dataProviders)
      .set(
        outcome.status === "failed"
          ? {
              lastErrorAt: finishedAt,
              consecutiveFailures: sql`${dataProviders.consecutiveFailures} + 1`,
            }
          : { lastSuccessAt: finishedAt, consecutiveFailures: 0 },
      )
      .where(eq(dataProviders.id, record.id));

    return { provider: key, ...outcome };
  } catch (error) {
    deps.log.error({ err: error, provider: key }, "sağlayıcı çalıştırılamadı");
    return {
      provider: key,
      status: "failed",
      ...empty,
      errorCode: "runner_error",
      errorMessage: "Çalıştırılamadı",
    };
  } finally {
    await conn`select pg_advisory_unlock(hashtext(${`ingest:${key}`}))`.catch(() => {});
    conn.release();
  }
}

/** Ardışık hatalarda bekleme süresi katlanarak uzar (en fazla 16×, üst sınır 6 saat) */
export function nextDelayMinutes(intervalMinutes: number, consecutiveFailures: number): number {
  const factor = 2 ** Math.min(consecutiveFailures, 4);
  return Math.min(intervalMinutes * factor, 360);
}
