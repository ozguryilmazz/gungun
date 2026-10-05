import { desc, eq } from "drizzle-orm";
import { dataProviders, fetchRuns, type Database } from "@gundemci/db";
import { PROVIDERS, nextDelayMinutes, runProvider, type RunnerDeps } from "./runner.ts";

const DEFAULT_INTERVAL_MINUTES = 15;
/** Kaynakları yormamak için en kısa aralık */
const MIN_INTERVAL_MINUTES = 10;

async function lastStartedAt(db: Database, providerId: number): Promise<Date | null> {
  const [row] = await db
    .select({ startedAt: fetchRuns.startedAt })
    .from(fetchRuns)
    .where(eq(fetchRuns.providerId, providerId))
    .orderBy(desc(fetchRuns.startedAt))
    .limit(1);
  return row?.startedAt ?? null;
}

/** Zamanı gelmiş, açık sağlayıcıları sırayla çalıştırır; yeni kayıt sayısını döndürür */
export async function tick(deps: RunnerDeps): Promise<number> {
  const now = deps.now?.() ?? new Date();
  const providers = await deps.db
    .select({
      id: dataProviders.id,
      key: dataProviders.key,
      config: dataProviders.config,
      consecutiveFailures: dataProviders.consecutiveFailures,
    })
    .from(dataProviders)
    .where(eq(dataProviders.isEnabled, true));

  let newItems = 0;
  for (const p of providers) {
    if (!PROVIDERS[p.key]) continue;
    const configured =
      typeof p.config.minIntervalMinutes === "number"
        ? p.config.minIntervalMinutes
        : DEFAULT_INTERVAL_MINUTES;
    const delay = nextDelayMinutes(
      Math.max(configured, MIN_INTERVAL_MINUTES),
      p.consecutiveFailures,
    );
    const last = await lastStartedAt(deps.db, p.id);
    if (last && now.getTime() - last.getTime() < delay * 60_000) continue;

    const result = await runProvider(deps, p.key);
    newItems += result.itemsFetched;
    deps.log.info(
      {
        provider: p.key,
        status: result.status,
        items: result.itemsFetched,
        skipped: result.skipped,
      },
      "veri çekme tamamlandı",
    );
  }
  return newItems;
}
