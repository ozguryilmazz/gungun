import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

export type Database = ReturnType<typeof createDb>["db"];

export interface CreateDbOptions {
  /** Havuzdaki en fazla bağlantı sayısı */
  max?: number;
}

/**
 * Veritabanı bağlantısı oluşturur. Sorgular her zaman parametreli gönderilir
 * (postgres.js + Drizzle), elle SQL string birleştirme yapılmaz.
 */
export function createDb(databaseUrl: string, options: CreateDbOptions = {}) {
  const client = postgres(databaseUrl, {
    max: options.max ?? 10,
    // Sunucu bildirimlerini (NOTICE) konsola basma
    onnotice: () => {},
  });
  const db = drizzle(client, { schema });
  return { db, client, close: () => client.end({ timeout: 5 }) };
}
