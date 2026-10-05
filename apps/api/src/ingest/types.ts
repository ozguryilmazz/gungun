import type { Database, FetchRunDetail } from "@gundemci/db";
import type { FastifyBaseLogger } from "fastify";
import type { FetchPolicy, SafeResponse } from "../lib/safe-http.ts";

export interface ProviderRecord {
  id: number;
  key: string;
  name: string;
  isEnabled: boolean;
  config: Record<string, unknown>;
  consecutiveFailures: number;
}

export type Fetcher = (url: string, policy: FetchPolicy) => Promise<SafeResponse>;

export type Logger = Pick<FastifyBaseLogger, "info" | "warn" | "error">;

export interface ProviderContext {
  db: Database;
  provider: ProviderRecord;
  now: Date;
  fetcher: Fetcher;
  log: Logger;
}

export interface ProviderOutcome {
  status: "success" | "partial" | "failed";
  /** Yeni eklenen kayıt sayısı */
  itemsFetched: number;
  details: FetchRunDetail[];
  errorCode?: string;
  errorMessage?: string;
}

export interface IngestProvider {
  key: string;
  run(ctx: ProviderContext): Promise<ProviderOutcome>;
}

export const BOT_USER_AGENT = "gundemciBot/0.1 (+https://gundemci.org/bot)";
