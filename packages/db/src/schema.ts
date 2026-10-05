import type { ScoreComponents } from "@gundemci/shared";
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  char,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

// ─────────────────────────────────────────────────────────────
// Ortak yardımcılar
// ─────────────────────────────────────────────────────────────

const timestamptz = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

const createdAt = () => timestamptz("created_at").notNull().defaultNow();
const updatedAt = () =>
  timestamptz("updated_at")
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

/** Örnek (seed) veriyi gerçek veriden ayırmak için zorunlu işaret. */
const isMock = () => boolean("is_mock").notNull().default(false);

// ─────────────────────────────────────────────────────────────
// Enum'lar
// ─────────────────────────────────────────────────────────────

export const topicStatus = pgEnum("topic_status", [
  "candidate", // aday: eşik henüz aşılmadı, public'te görünmez
  "published", // yayında
  "cooling", // gündemden düşüyor, hâlâ görünür
  "archived", // arşivde, yalnızca arşiv sayfalarında
  "hidden", // admin tarafından gizlendi (soft delete)
]);

export const summaryOrigin = pgEnum("summary_origin", ["none", "manual", "ai"]);

export const providerKind = pgEnum("provider_kind", ["trend", "news", "social", "manual"]);

export const fetchStatus = pgEnum("fetch_status", ["running", "success", "partial", "failed"]);

export const timelineEventType = pgEnum("timeline_event_type", [
  "first_source", // konuyla ilgili ilk kaynak
  "news_spread", // birden fazla yayıncıda yer aldı
  "search_spike", // arama ilgisinde sıçrama
  "entered_top5", // gündem sıralamasında ilk 5'e girdi
  "peak", // zirve skor
]);

export const adminRole = pgEnum("admin_role", ["admin", "editor"]);

// ─────────────────────────────────────────────────────────────
// Sözlük tabloları
// ─────────────────────────────────────────────────────────────

export const categories = pgTable("categories", {
  id: smallint("id").primaryKey().generatedAlwaysAsIdentity(),
  slug: varchar("slug", { length: 32 }).notNull().unique(),
  name: varchar("name", { length: 64 }).notNull(),
  sortOrder: smallint("sort_order").notNull().default(0),
  createdAt: createdAt(),
});

// ─────────────────────────────────────────────────────────────
// Veri kaynakları
// ─────────────────────────────────────────────────────────────

/** Veri sağlayıcı adapter'ları (google_trends, rss_news ...). Secret burada TUTULMAZ. */
export const dataProviders = pgTable("data_providers", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  key: varchar("key", { length: 48 }).notNull().unique(),
  kind: providerKind("kind").notNull(),
  name: varchar("name", { length: 96 }).notNull(),
  isEnabled: boolean("is_enabled").notNull().default(false),
  config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
  lastSuccessAt: timestamptz("last_success_at"),
  lastErrorAt: timestamptz("last_error_at"),
  consecutiveFailures: integer("consecutive_failures").notNull().default(0),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/**
 * Yayıncılar (haber siteleri). Aktif yayıncıların `feedUrl` adresleri aynı zamanda dış
 * istekler için SSRF allowlist'idir: worker yalnızca burada kayıtlı adreslere istek atar.
 */
export const publishers = pgTable(
  "publishers",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    name: varchar("name", { length: 96 }).notNull(),
    domain: varchar("domain", { length: 253 }).notNull().unique(),
    homepageUrl: varchar("homepage_url", { length: 2048 }).notNull(),
    feedUrl: varchar("feed_url", { length: 2048 }),
    isActive: boolean("is_active").notNull().default(true),
    isMock: isMock(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check("publishers_homepage_https", sql`${t.homepageUrl} like 'https://%'`),
    check("publishers_feed_https", sql`${t.feedUrl} is null or ${t.feedUrl} like 'https://%'`),
  ],
);

export const fetchRuns = pgTable(
  "fetch_runs",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    providerId: integer("provider_id")
      .notNull()
      .references(() => dataProviders.id, { onDelete: "cascade" }),
    startedAt: timestamptz("started_at").notNull().defaultNow(),
    finishedAt: timestamptz("finished_at"),
    status: fetchStatus("status").notNull().default("running"),
    itemsFetched: integer("items_fetched").notNull().default(0),
    // Yalnızca temizlenmiş, kullanıcı/secret bilgisi içermeyen hata özeti
    errorCode: varchar("error_code", { length: 64 }),
    errorMessage: varchar("error_message", { length: 500 }),
    // Kaynak (feed) bazında özet sonuç: [{ name, ok, items, error? }] — secret içermez
    details: jsonb("details").$type<FetchRunDetail[]>().notNull().default([]),
  },
  (t) => [index("fetch_runs_provider_started_idx").on(t.providerId, t.startedAt.desc())],
);

export interface FetchRunDetail {
  name: string;
  ok: boolean;
  /** Yeni eklenen kayıt */
  items: number;
  /** Akışta bulunan geçerli öğe */
  parsed?: number;
  /** Başka alan adına gittiği için atlanan öğe */
  offDomain?: number;
  /** Örnek atlanan alan adları (teşhis için, en fazla 3) */
  offDomainHosts?: string[];
  error?: string;
}

/**
 * Arama trendi gözlemi: bir terimin trend listesinde görüldüğü an.
 * Her çekmede listedeki terimler kaydedilir; zaman serisi aşama 8'de skora girer.
 */
export const trendSignals = pgTable(
  "trend_signals",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    providerId: integer("provider_id")
      .notNull()
      .references(() => dataProviders.id, { onDelete: "cascade" }),
    term: varchar("term", { length: 200 }).notNull(),
    geo: char("geo", { length: 2 }).notNull(),
    approxTraffic: integer("approx_traffic"),
    observedAt: timestamptz("observed_at").notNull(),
    publishedAt: timestamptz("published_at"),
    // İlgili haber bağlantıları (en fazla 5): yalnızca başlık, adres, kaynak adı
    related: jsonb("related")
      .$type<{ title: string; url: string; source: string }[]>()
      .notNull()
      .default([]),
  },
  (t) => [
    uniqueIndex("trend_signals_provider_term_time_uq").on(t.providerId, t.term, t.observedAt),
    index("trend_signals_observed_idx").on(t.observedAt.desc()),
    index("trend_signals_term_idx").on(t.term),
    check(
      "trend_signals_traffic_positive",
      sql`${t.approxTraffic} is null or ${t.approxTraffic} >= 0`,
    ),
  ],
);

/** Kaynaklardan gelen tekil içerik. Yalnızca metadata; haber GÖVDESİ SAKLANMAZ. */
export const sourceItems = pgTable(
  "source_items",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    providerId: integer("provider_id")
      .notNull()
      .references(() => dataProviders.id, { onDelete: "restrict" }),
    publisherId: integer("publisher_id").references(() => publishers.id, {
      onDelete: "restrict",
    }),
    url: varchar("url", { length: 2048 }).notNull(),
    // Normalize edilmiş URL'nin SHA-256 hex özeti — tekrar kayıt engeli
    urlHash: char("url_hash", { length: 64 }).notNull().unique(),
    title: varchar("title", { length: 300 }).notNull(),
    publishedAt: timestamptz("published_at"),
    fetchedAt: timestamptz("fetched_at").notNull().defaultNow(),
    isMock: isMock(),
  },
  (t) => [
    index("source_items_published_idx").on(t.publishedAt.desc()),
    index("source_items_publisher_idx").on(t.publisherId),
    check("source_items_url_http", sql`${t.url} like 'https://%' or ${t.url} like 'http://%'`),
  ],
);

// ─────────────────────────────────────────────────────────────
// Gündem konuları
// ─────────────────────────────────────────────────────────────

export const topics = pgTable(
  "topics",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: varchar("slug", { length: 160 }).notNull().unique(),
    title: varchar("title", { length: 200 }).notNull(),
    categoryId: smallint("category_id")
      .notNull()
      .references(() => categories.id, { onDelete: "restrict" }),
    summary: text("summary"),
    // "Neden gündemde?" maddeleri (doğrulanmış kısa metinler)
    reasons: jsonb("reasons").$type<string[]>().notNull().default([]),
    status: topicStatus("status").notNull().default("candidate"),
    summaryOrigin: summaryOrigin("summary_origin").notNull().default("none"),
    isMock: isMock(),
    firstSeenAt: timestamptz("first_seen_at").notNull().defaultNow(),
    publishedAt: timestamptz("published_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("topics_status_updated_idx").on(t.status, t.updatedAt.desc()),
    index("topics_category_idx").on(t.categoryId),
    check("topics_slug_format", sql`${t.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`),
    check("topics_summary_length", sql`${t.summary} is null or char_length(${t.summary}) <= 1200`),
    check("topics_reasons_array", sql`jsonb_typeof(${t.reasons}) = 'array'`),
  ],
);

/** Başlık/slug değişince eski URL'lerin 301 ile yönlendirilmesi için. */
export const topicSlugRedirects = pgTable(
  "topic_slug_redirects",
  {
    oldSlug: varchar("old_slug", { length: 160 }).primaryKey(),
    topicId: uuid("topic_id")
      .notNull()
      .references(() => topics.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [index("topic_slug_redirects_topic_idx").on(t.topicId)],
);

export type { ScoreComponent, ScoreComponents } from "@gundemci/shared";

/** Konunun belirli bir andaki skoru. Trend, yükselen/düşen ve arşiv buradan türetilir. */
export const topicSnapshots = pgTable(
  "topic_snapshots",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    topicId: uuid("topic_id")
      .notNull()
      .references(() => topics.id, { onDelete: "cascade" }),
    capturedAt: timestamptz("captured_at").notNull().defaultNow(),
    // Hiç sinyal yoksa skor hesaplanmaz (null) — uydurma skor yok
    score: smallint("score"),
    components: jsonb("components").$type<ScoreComponents>().notNull().default({}),
    signalsAvailable: smallint("signals_available").notNull().default(0),
    signalsTotal: smallint("signals_total").notNull().default(0),
    rank: smallint("rank"),
    isMock: isMock(),
  },
  (t) => [
    uniqueIndex("topic_snapshots_topic_time_uq").on(t.topicId, t.capturedAt),
    index("topic_snapshots_captured_idx").on(t.capturedAt.desc()),
    check("topic_snapshots_score_range", sql`${t.score} is null or ${t.score} between 0 and 100`),
    check(
      "topic_snapshots_signals_range",
      sql`${t.signalsAvailable} >= 0 and ${t.signalsAvailable} <= ${t.signalsTotal}`,
    ),
    check("topic_snapshots_rank_positive", sql`${t.rank} is null or ${t.rank} > 0`),
  ],
);

export const topicItems = pgTable(
  "topic_items",
  {
    topicId: uuid("topic_id")
      .notNull()
      .references(() => topics.id, { onDelete: "cascade" }),
    sourceItemId: bigint("source_item_id", { mode: "number" })
      .notNull()
      .references(() => sourceItems.id, { onDelete: "cascade" }),
    relevance: real("relevance").notNull().default(1),
    addedAt: timestamptz("added_at").notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.topicId, t.sourceItemId] }),
    index("topic_items_source_item_idx").on(t.sourceItemId),
    check("topic_items_relevance_range", sql`${t.relevance} >= 0 and ${t.relevance} <= 1`),
  ],
);

/** Gündem zaman çizelgesi. Yalnızca gerçek veriden (veya işaretli seed'den) üretilir. */
export const timelineEvents = pgTable(
  "timeline_events",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    topicId: uuid("topic_id")
      .notNull()
      .references(() => topics.id, { onDelete: "cascade" }),
    occurredAt: timestamptz("occurred_at").notNull(),
    type: timelineEventType("type").notNull(),
    sourceItemId: bigint("source_item_id", { mode: "number" }).references(() => sourceItems.id, {
      onDelete: "set null",
    }),
    isMock: isMock(),
  },
  (t) => [index("timeline_events_topic_time_idx").on(t.topicId, t.occurredAt)],
);

// ─────────────────────────────────────────────────────────────
// Yönetim (admin)
// ─────────────────────────────────────────────────────────────

export const adminUsers = pgTable(
  "admin_users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: varchar("email", { length: 254 }).notNull(),
    // argon2id hash; düz şifre ASLA saklanmaz
    passwordHash: text("password_hash").notNull(),
    role: adminRole("role").notNull().default("editor"),
    isActive: boolean("is_active").notNull().default(true),
    failedLoginCount: integer("failed_login_count").notNull().default(0),
    lockedUntil: timestamptz("locked_until"),
    lastLoginAt: timestamptz("last_login_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("admin_users_email_lower_uq").on(sql`lower(${t.email})`)],
);

export const adminSessions = pgTable(
  "admin_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => adminUsers.id, { onDelete: "cascade" }),
    // Ham oturum token'ı DB'de tutulmaz; yalnızca SHA-256 özeti
    tokenHash: char("token_hash", { length: 64 }).notNull().unique(),
    createdAt: createdAt(),
    expiresAt: timestamptz("expires_at").notNull(),
    lastSeenAt: timestamptz("last_seen_at").notNull().defaultNow(),
    // IP adresi düz saklanmaz (KVKK); yalnızca tuzlu özet
    ipHash: char("ip_hash", { length: 64 }),
  },
  (t) => [
    index("admin_sessions_user_idx").on(t.userId),
    index("admin_sessions_expires_idx").on(t.expiresAt),
  ],
);

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    adminUserId: uuid("admin_user_id").references(() => adminUsers.id, { onDelete: "set null" }),
    action: varchar("action", { length: 64 }).notNull(),
    entityType: varchar("entity_type", { length: 32 }).notNull(),
    entityId: varchar("entity_id", { length: 64 }),
    changes: jsonb("changes").$type<Record<string, unknown>>(),
    createdAt: createdAt(),
  },
  (t) => [
    index("audit_logs_created_idx").on(t.createdAt.desc()),
    index("audit_logs_entity_idx").on(t.entityType, t.entityId),
  ],
);
