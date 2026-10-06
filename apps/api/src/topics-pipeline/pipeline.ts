// Gündem üretimi — ARAMA ÖNCELİKLİ (docs/02-arama-oncelikli-plan.md).
//
//  1. Trend konuları: Google Trends'teki her arama terimi bir konudur. Haberler konuyu AÇIKLAR:
//     eşleşen haber kümesi + Google'ın "ilgili haberler" listesi konuya bağlanır.
//  2. Haber konuları: Hiçbir aramayla eşleşmeyen ama çok kaynakta geçen olaylar
//     ("Haberlerde öne çıkanlar"); ana listeye karışmaz.
//
// Yapay zekâ KULLANILMAZ; özet üretilmez, "neden gündemde" maddeleri yalnızca ölçülen veridir.
// Örnek (mock) konulara dokunulmaz.
import { randomBytes } from "node:crypto";
import { and, eq, inArray, notInArray, sql } from "drizzle-orm";
import {
  categories,
  dataProviders,
  publishers,
  sourceItems,
  timelineEvents,
  topicItems,
  topicSnapshots,
  topics,
  type Database,
} from "@gundemci/db";
import {
  COMPONENT_KEYS,
  computeScore,
  type ComponentInput,
  type ScoreComponents,
} from "@gundemci/shared";
import type postgres from "postgres";
import { urlHash } from "../ingest/normalize.ts";
import type { Logger } from "../ingest/types.ts";
import { inferCategory } from "./category.ts";
import { FILTER_REASON_LABELS, classifyTerm } from "./term-filter.ts";
import {
  clusterItems,
  distinctPublishers,
  representative,
  type Cluster,
  type ClusterInput,
} from "./cluster.ts";
import {
  calmTitle,
  isMediaTerm,
  isTermWithCase,
  looksTurkish,
  slugify,
  stem,
  tokenize,
  words,
} from "./text.ts";

/** Filtreyle gizlenen konuların "reasons" alanındaki işaret (elle gizlenenlerden ayırmak için) */
export const FILTER_MARK = "Filtre: ";

/** Konu oluşturma ve yaşam döngüsü eşikleri */
export const RULES = {
  windowHours: 24,
  /** Haber konusu kaydı için en az farklı yayıncı */
  minPublishersToCreate: 2,
  /** Haber konusunun "Haberlerde öne çıkanlar"da görünmesi için en az farklı yayıncı */
  minPublishersToPublishNews: 4,
  /** Haber konusu: bu süredir yeni haber yoksa "soğuyan" / arşiv */
  newsCoolingAfterHours: 6,
  newsArchiveAfterHours: 24,
  /** Trends verisi bu kadar eskiyse güncel trend listesi yok sayılır */
  trendsFreshHours: 2,
  /** Trend konusu listeden çıktıktan bu kadar sonra arşive düşer (arada "soğuyan") */
  trendArchiveAfterHours: 3,
  /** Bir trend teriminin haber kümesiyle eşleşmesi için terimi içeren başlık oranı */
  trendMatchRatio: 0.3,
  /** "3 saat önceki" trafik ölçümü için en az geçmiş */
  trendCompareMinHours: 2.5,
  /** YouTube trend listesi bu kadar eskiyse sosyal sinyal "bekleniyor" sayılır */
  youtubeFreshHours: 2,
} as const;

/** Sosyal sinyal için YouTube trend listesindeki bir video (yalnızca başlık ve sıra kullanılır) */
export interface YoutubeSignalVideo {
  title: string;
  rank: number;
}

/**
 * Sosyal sinyal (YouTube): trend terimi YouTube Türkiye trend listesindeki video başlıklarında
 * geçiyor mu? Değer en iyi sıraya göre (1. sıra = 1,0; 50. sıra ≈ 0,3), her ek video +0,1 (en fazla +0,2).
 * Terim hiçbir videoda geçmiyorsa 0 (ölçüldü, sinyal yok). Medya adları eşleşmez.
 */
export function youtubeSocial(
  term: string,
  videos: YoutubeSignalVideo[],
): { value: number; matches: number; bestRank: number | null } {
  if (isMediaTerm(term)) return { value: 0, matches: 0, bestRank: null };
  const hits = videos.filter((v) => titleMentionsTerm(v.title, term));
  if (hits.length === 0) return { value: 0, matches: 0, bestRank: null };
  const bestRank = Math.min(...hits.map((v) => v.rank));
  const base = 1 - ((Math.min(bestRank, 50) - 1) / 49) * 0.7;
  const bonus = Math.min((hits.length - 1) * 0.1, 0.2);
  return { value: round4(Math.min(base + bonus, 1)), matches: hits.length, bestRank };
}

export interface PipelineResult {
  skipped?: "locked";
  itemsInWindow: number;
  clusters: number;
  trends: number;
  created: number;
  snapshots: number;
  published: number;
  cooling: number;
  archived: number;
  /** Gündem başlığı olamayacağı için elenen arama sayısı */
  filtered: number;
}

export interface PipelineDeps {
  db: Database;
  client: postgres.Sql;
  log: Logger;
  now?: () => Date;
}

type Status = "candidate" | "published" | "cooling" | "archived" | "hidden";

/** Eşleştirme için trend terimi */
export interface TrendObservation {
  term: string;
  tokens: string[];
  approxTraffic: number | null;
}

/** Son 24 saatin gözlemlerinden derlenmiş bir trend terimi */
export interface TrendInfo extends TrendObservation {
  key: string;
  /** Şu an güncel trend listesinde mi? */
  current: boolean;
  firstObservedAt: Date;
  lastObservedAt: Date;
  /** ~3 saat önceki trafik (yoksa null) */
  previousTraffic: number | null;
  related: { title: string; url: string; source: string }[];
}

const hoursAgo = (now: Date, h: number) => new Date(now.getTime() - h * 3_600_000);

export function trendKey(term: string): string {
  return term.toLocaleLowerCase("tr-TR").trim().replace(/\s+/g, " ").slice(0, 200);
}

const isLetter = (ch: string | undefined) => !!ch && /[a-zçğıöşüâîû0-9]/i.test(ch);

/**
 * Google trend terimleri çoğunlukla küçük harftir ("aöf", "ali koç"). Doğru yazım, terimin geçtiği
 * haber başlıklarından öğrenilir (tamamı büyük harf olmayan başlıklarda en sık görülen yazım: "AÖF").
 * Bulunamazsa kelimelerin baş harfi büyütülür ("Ali Koç").
 */
export function displayTerm(term: string, sampleTitles: string[] = []): string {
  const t = term.trim().replace(/\s+/g, " ");
  if (t !== t.toLocaleLowerCase("tr-TR")) return t.slice(0, 200);
  const needle = t.toLocaleLowerCase("tr-TR");
  const counts = new Map<string, number>();
  for (const title of sampleTitles) {
    const letters = title.replace(/[^a-zA-ZçğıöşüÇĞİÖŞÜ]/g, "");
    const upper = title.replace(/[^A-ZÇĞİÖŞÜ]/g, "");
    if (letters.length >= 8 && upper.length / letters.length > 0.7) continue; // bağıran başlık
    const lower = title.toLocaleLowerCase("tr-TR");
    if (lower.length !== title.length) continue; // güvenli dilimleme için
    let from = 0;
    for (let i = lower.indexOf(needle, from); i !== -1; i = lower.indexOf(needle, from)) {
      if (!isLetter(lower[i - 1]) && !isLetter(lower[i + needle.length])) {
        const original = title.slice(i, i + needle.length);
        counts.set(original, (counts.get(original) ?? 0) + 1);
      }
      from = i + 1;
    }
  }
  const learned = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  if (learned && learned !== needle) return learned.slice(0, 200);
  return t
    .split(" ")
    .map((w) => w.charAt(0).toLocaleUpperCase("tr-TR") + w.slice(1))
    .join(" ")
    .slice(0, 200);
}

/**
 * Başlık, trend terimini (kurallara uygun biçimde) içeriyor mu?
 * - Tek kelime: kelimenin kendisi veya hal ekli hâli ("derbi" → "derbide"; iyelik eki kabul edilmez).
 * - Çok kelime: terimin HER kelimesi başlıkta geçmeli. Sayılar birebir ("6 ekim" ≠ "1 Ekim"),
 *   kısa kelimeler ("ne", "ve") aynen; diğerleri hal ekli hâli veya aynı kökle.
 */
export function titleMentionsTerm(title: string, term: string): boolean {
  const termWords = words(term);
  if (termWords.length === 0) return false;
  const titleWords = words(title);
  if (termWords.length === 1) return titleWords.some((w) => isTermWithCase(w, termWords[0]!));
  const titleStems = new Set(tokenize(title));
  return termWords.every((tw) => {
    if (/^\d+$/.test(tw) || tw.length < 3) return titleWords.includes(tw);
    if (titleWords.some((w) => isTermWithCase(w, tw))) return true;
    const s = stem(tw);
    return s !== null && titleStems.has(s);
  });
}

/** Haber başlığı aramayı AÇIKLAYABİLİR mi: Türkçe olmalı ve terimi içermeli */
export function headlineExplainsTerm(title: string, term: string): boolean {
  return looksTurkish(title) && titleMentionsTerm(title, term);
}

/** Arama ilgisi: log ölçek, 1 milyon arama ≈ 1.0; trafik bilinmiyorsa 0.5 */
function trafficToNormalized(traffic: number | null): number {
  if (traffic === null || traffic <= 0) return 0.5;
  return Math.min(Math.log10(traffic) / 6, 1);
}

const round4 = (n: number) => Number(n.toFixed(4));

/**
 * Bir trend teriminin bir haber kümesiyle eşleşme oranı. Yanlış eşleşmeye karşı:
 *  - medya adları (Sözcü, Sabah, NTV…) hiç eşleşmez;
 *  - tek kelimelik terim, kelimenin kendisi veya hal ekli hâliyle eşleşir; iyelik ekli hâli eşleşmez:
 *    "derbi" → "derbide" eşleşir, "sözcü" → "AK Parti Sözcüsü" eşleşmez;
 *  - çok kelimeli terimde tüm kelime kökleri başlıkta geçmelidir.
 */
export function trendMatchRatio(cluster: Cluster, trend: TrendObservation): number {
  if (trend.tokens.length === 0 || isMediaTerm(trend.term)) return 0;
  const hits = cluster.items.filter((i) => titleMentionsTerm(i.title, trend.term)).length;
  return hits / cluster.items.length;
}

/** Kümeyle en iyi eşleşen trend (eşik altında null) */
export function matchTrend(cluster: Cluster, trends: TrendObservation[]): TrendObservation | null {
  let best: TrendObservation | null = null;
  let bestRatio = 0;
  for (const trend of trends) {
    const ratio = trendMatchRatio(cluster, trend);
    if (ratio >= RULES.trendMatchRatio && ratio > bestRatio) {
      best = trend;
      bestRatio = ratio;
    }
  }
  return best;
}

/** Trend terimiyle en iyi eşleşen haber kümesi (eşitlikte büyük küme) */
export function bestClusterForTrend(clusters: Cluster[], trend: TrendObservation): Cluster | null {
  let best: Cluster | null = null;
  let bestRatio = 0;
  for (const c of clusters) {
    const ratio = trendMatchRatio(c, trend);
    if (ratio < RULES.trendMatchRatio) continue;
    if (ratio > bestRatio || (ratio === bestRatio && best && c.items.length > best.items.length)) {
      best = c;
      bestRatio = ratio;
    }
  }
  return best;
}

/** Trend konusu skoru: arama %50 · sosyal %25 · haber %15 · hız %10 (bkz. shared/scoring) */
export function scoreTrend(
  trend: TrendInfo,
  newsItems: ClusterInput[],
  now: Date,
  ctx: {
    publisherTotal: number;
    trendsAvailable: boolean;
    /** null: YouTube verisi yok/eski → sosyal sinyal "bekleniyor" */
    youtube?: YoutubeSignalVideo[] | null;
  },
): { normalized: ComponentInput; raw: Record<string, number | null> } {
  const social = ctx.youtube && trend.current ? youtubeSocial(trend.term, ctx.youtube) : null;
  const recentNews = newsItems.filter((i) => i.at >= hoursAgo(now, 6));
  const newsSources =
    distinctPublishers(recentNews) +
    new Set(trend.related.map((r) => r.source.toLocaleLowerCase("tr-TR"))).size;
  const newsVisibility =
    newsSources === 0
      ? 0
      : Math.min(Math.log(1 + newsSources) / Math.log(1 + Math.max(ctx.publisherTotal, 2)), 1);

  // Hız: listeye son 3 saatte girdiyse en yüksek; değilse trafik değişimi
  let velocity: number;
  if (!trend.current) velocity = 0;
  else if (trend.firstObservedAt >= hoursAgo(now, 3)) velocity = 1;
  else if (trend.previousTraffic && trend.approxTraffic) {
    const ratio = trend.approxTraffic / trend.previousTraffic;
    velocity = Math.min(Math.max(0.33 + (Math.log2(ratio) / Math.log2(3)) * 0.67, 0), 1);
  } else velocity = 0.33;

  const searchInterest = ctx.trendsAvailable
    ? trend.current
      ? trafficToNormalized(trend.approxTraffic)
      : 0
    : null;

  return {
    normalized: {
      search_interest: searchInterest === null ? null : round4(searchInterest),
      // Listeden çıkmış aramada sosyal sinyal 0 (ölçüm var, güncel değil); veri yoksa null
      social: social ? social.value : ctx.youtube ? 0 : null,
      news_visibility: round4(newsVisibility),
      velocity: round4(velocity),
    },
    raw: {
      search_interest: trend.approxTraffic,
      social: social ? social.matches : null,
      news_visibility: newsSources,
      velocity: trend.previousTraffic,
    },
  };
}

/** Haber konusu skoru (aramada olmadığı için arama ilgisi 0; Trends verisi yoksa "bekleniyor") */
export function scoreCluster(
  items: ClusterInput[],
  now: Date,
  ctx: { publisherTotal: number; trendsAvailable: boolean },
): { normalized: ComponentInput; raw: Record<string, number | null> } {
  const recent6 = items.filter((i) => i.at >= hoursAgo(now, 6));
  const pub6 = distinctPublishers(recent6);
  const last1 = items.filter((i) => i.at >= hoursAgo(now, 1)).length;
  const prev3 = items.filter((i) => i.at >= hoursAgo(now, 4) && i.at < hoursAgo(now, 1)).length;

  const newsVisibility =
    pub6 === 0
      ? 0
      : Math.min(Math.log(1 + pub6) / Math.log(1 + Math.max(ctx.publisherTotal, 2)), 1);
  const ratio = last1 / Math.max(prev3 / 3, 1 / 3);
  const velocity = last1 === 0 ? 0 : Math.min(ratio / 3, 1);

  return {
    normalized: {
      search_interest: ctx.trendsAvailable ? 0 : null,
      social: null,
      news_visibility: round4(newsVisibility),
      velocity: round4(velocity),
    },
    raw: { search_interest: null, social: null, news_visibility: pub6, velocity: last1 },
  };
}

/** Trend konusu için ölçülen bilgiler (uydurma yok) */
export function trendReasons(
  trend: TrendInfo,
  newsItems: ClusterInput[],
  now: Date,
  youtube: YoutubeSignalVideo[] | null = null,
): string[] {
  const reasons: string[] = [];
  if (trend.current) {
    const traffic = trend.approxTraffic
      ? ` (yaklaşık ${trend.approxTraffic.toLocaleString("tr-TR")}+ arama)`
      : "";
    reasons.push(`Google’da Türkiye trend listesinde${traffic}`);
    const hours = Math.floor((now.getTime() - trend.firstObservedAt.getTime()) / 3_600_000);
    reasons.push(
      hours >= 1 ? `${hours} saattir trend listesinde` : "Son 1 saat içinde trend listesine girdi",
    );
  } else {
    reasons.push("Google’ın Türkiye trend listesinden çıktı");
  }
  const sources = distinctPublishers(newsItems) + new Set(trend.related.map((r) => r.source)).size;
  if (sources > 0) reasons.push(`${sources} haber kaynağında konuyla ilgili haber var`);
  if (youtube && trend.current) {
    const yt = youtubeSocial(trend.term, youtube);
    if (yt.matches > 0)
      reasons.push(
        `YouTube Türkiye trendlerinde ${yt.matches} videonun başlığında geçiyor (en üst: ${yt.bestRank}. sıra)`,
      );
  }
  return reasons;
}

/** Haber konusu için ölçülen bilgiler (uydurma yok) */
export function newsReasons(items: ClusterInput[], now: Date): string[] {
  const reasons = [`${distinctPublishers(items)} farklı haber kaynağında yer aldı`];
  const lastHour = items.filter((i) => i.at.getTime() >= now.getTime() - 3_600_000).length;
  if (lastHour > 0) reasons.push(`Son 1 saatte ${lastHour} yeni haber yayımlandı`);
  reasons.push("Google’ın Türkiye trend listesinde değil");
  return reasons;
}

export function nextNewsStatus(
  current: Status,
  ctx: { lastItemAt: Date; publishers: number; now: Date },
): Status {
  if (current === "hidden") return "hidden";
  const idleHours = (ctx.now.getTime() - ctx.lastItemAt.getTime()) / 3_600_000;
  if (idleHours > RULES.newsArchiveAfterHours) return "archived";
  const qualifies = ctx.publishers >= RULES.minPublishersToPublishNews;
  if (current === "candidate")
    return qualifies && idleHours <= RULES.newsCoolingAfterHours ? "published" : "candidate";
  if (idleHours > RULES.newsCoolingAfterHours) return "cooling";
  return "published";
}

export function nextTrendStatus(current: Status, trend: TrendInfo, now: Date): Status {
  if (current === "hidden") return "hidden";
  if (trend.current) return "published";
  const idleHours = (now.getTime() - trend.lastObservedAt.getTime()) / 3_600_000;
  return idleHours > RULES.trendArchiveAfterHours ? "archived" : "cooling";
}

/** Son 24 saatin trend gözlemlerini terim bazında derler */
export function compileTrends(
  rows: {
    term: string;
    approx_traffic: number | null;
    observed_at: Date;
    related: TrendInfo["related"];
  }[],
  now: Date,
  trendsAvailable: boolean,
): TrendInfo[] {
  const latestBatch = rows.reduce<number>((max, r) => Math.max(max, r.observed_at.getTime()), 0);
  const byKey = new Map<string, typeof rows>();
  for (const r of rows) {
    const key = trendKey(r.term);
    const list = byKey.get(key) ?? [];
    list.push(r);
    byKey.set(key, list);
  }
  const compareBefore = hoursAgo(now, RULES.trendCompareMinHours).getTime();
  const out: TrendInfo[] = [];
  for (const [key, list] of byKey) {
    list.sort((a, b) => a.observed_at.getTime() - b.observed_at.getTime());
    const last = list[list.length - 1]!;
    const previous = [...list].reverse().find((r) => r.observed_at.getTime() <= compareBefore);
    out.push({
      key,
      term: last.term,
      tokens: tokenize(last.term),
      approxTraffic: last.approx_traffic,
      // Güncel = en son başarılı çekmede (±5 dk) listede ve Trends verisi taze
      current: trendsAvailable && latestBatch - last.observed_at.getTime() <= 5 * 60_000,
      firstObservedAt: list[0]!.observed_at,
      lastObservedAt: last.observed_at,
      previousTraffic: previous?.approx_traffic ?? null,
      related: Array.isArray(last.related) ? last.related.slice(0, 5) : [],
    });
  }
  return out;
}

async function uniqueSlug(db: Database, title: string): Promise<string> {
  const base = slugify(title, 72);
  for (let i = 0; i < 5; i++) {
    const slug = `${base}-${randomBytes(2).toString("hex")}`;
    const [exists] = await db
      .select({ id: topics.id })
      .from(topics)
      .where(eq(topics.slug, slug))
      .limit(1);
    if (!exists) return slug;
  }
  return `${base}-${randomBytes(4).toString("hex")}`;
}

type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

async function hasEvent(
  tx: Tx,
  topicId: string,
  type: (typeof timelineEvents.$inferInsert)["type"],
) {
  const [row] = await tx
    .select({ id: timelineEvents.id })
    .from(timelineEvents)
    .where(and(eq(timelineEvents.topicId, topicId), eq(timelineEvents.type, type)))
    .limit(1);
  return !!row;
}

async function writeSnapshot(
  tx: Tx,
  topicId: string,
  now: Date,
  scored: { normalized: ComponentInput; raw: Record<string, number | null> },
) {
  const computed = computeScore(scored.normalized);
  const components: ScoreComponents = {};
  for (const key of COMPONENT_KEYS) {
    const c = computed.components[key];
    if (c) components[key] = { ...c, raw: c.available ? (scored.raw[key] ?? null) : null };
  }
  const [snapshot] = await tx
    .insert(topicSnapshots)
    .values({
      topicId,
      capturedAt: now,
      score: computed.score,
      components,
      signalsAvailable: computed.signalsAvailable,
      signalsTotal: computed.signalsTotal,
    })
    .onConflictDoNothing()
    .returning({ id: topicSnapshots.id });
  return snapshot ? { id: snapshot.id, score: computed.score } : null;
}

export async function buildTopics(deps: PipelineDeps): Promise<PipelineResult> {
  const { db, log } = deps;
  const now = deps.now?.() ?? new Date();
  const result: PipelineResult = {
    itemsInWindow: 0,
    clusters: 0,
    trends: 0,
    created: 0,
    snapshots: 0,
    published: 0,
    cooling: 0,
    archived: 0,
    filtered: 0,
  };

  const conn = await deps.client.reserve();
  try {
    const [lock] = await conn`select pg_try_advisory_lock(hashtext('topics:build')) as ok`;
    if (!lock?.ok) return { ...result, skipped: "locked" };

    // ── Girdi 1: son 24 saatin haberleri; küme tohumu yalnızca HABER konusu bağlantıları ──
    const rows = await db.execute<{
      id: number;
      title: string;
      url: string;
      publisher_id: number | null;
      at: Date | string;
      topic_id: string | null;
    }>(sql`
      select si.id, si.title, si.url, si.publisher_id,
             coalesce(si.published_at, si.fetched_at) as at,
             nt.topic_id
      from source_items si
      left join lateral (
        select ti.topic_id from topic_items ti
        join topics t on t.id = ti.topic_id and t.kind = 'news' and t.is_mock = false
        where ti.source_item_id = si.id
        order by ti.added_at asc
        limit 1
      ) nt on true
      where si.is_mock = false
        and si.publisher_id is not null
        and coalesce(si.published_at, si.fetched_at) >= ${hoursAgo(now, RULES.windowHours).toISOString()}
        and coalesce(si.published_at, si.fetched_at) <= ${now.toISOString()}
    `);
    const items: ClusterInput[] = rows.map((r) => ({
      id: Number(r.id),
      title: r.title,
      url: r.url,
      publisherId: r.publisher_id,
      at: r.at instanceof Date ? r.at : new Date(r.at),
      topicId: r.topic_id,
    }));
    result.itemsInWindow = items.length;

    const [{ n: publisherTotal } = { n: 12 }] = await db.execute<{ n: number }>(
      sql`select count(*)::int as n from ${publishers} where is_active = true and is_mock = false`,
    );

    // ── Girdi 2: Trends (son 24 saat) ──
    const [trendsProvider] = await db
      .select({ id: dataProviders.id, lastSuccessAt: dataProviders.lastSuccessAt })
      .from(dataProviders)
      .where(eq(dataProviders.key, "google_trends"));
    const trendsAvailable =
      !!trendsProvider?.lastSuccessAt &&
      trendsProvider.lastSuccessAt >= hoursAgo(now, RULES.trendsFreshHours);
    const trendRows = trendsProvider
      ? await db.execute<{
          term: string;
          approx_traffic: number | null;
          observed_at: Date | string;
          related: TrendInfo["related"];
        }>(sql`
          select term, approx_traffic, observed_at, related from trend_signals
          where provider_id = ${trendsProvider.id}
            and observed_at >= ${hoursAgo(now, RULES.windowHours).toISOString()}
            and observed_at <= ${now.toISOString()}
        `)
      : [];
    // ── Girdi 2b: Google Haberler aramasında trend terimleri için bulunan haberler (son 24 saat) ──
    const searchRows = await db.execute<{
      trend_key: string;
      title: string;
      url: string;
      source: string | null;
    }>(sql`
      select l.trend_key, si.title, si.url, si.source_name as source
      from trend_news_links l
      join source_items si on si.id = l.source_item_id
      where l.found_at >= ${hoursAgo(now, RULES.windowHours).toISOString()}
        and l.found_at <= ${now.toISOString()}
      order by coalesce(si.published_at, si.fetched_at) desc
    `);
    const searchNews = new Map<string, TrendInfo["related"]>();
    for (const r of searchRows) {
      const list = searchNews.get(r.trend_key) ?? [];
      list.push({ title: r.title, url: r.url, source: r.source ?? "Google Haberler" });
      searchNews.set(r.trend_key, list);
    }

    // ── Girdi 3: YouTube Türkiye trend listesi (sosyal sinyal; yalnızca güncelse) ──
    const [youtubeProvider] = await db
      .select({ id: dataProviders.id, lastSuccessAt: dataProviders.lastSuccessAt })
      .from(dataProviders)
      .where(eq(dataProviders.key, "youtube_trending"));
    let youtube: YoutubeSignalVideo[] | null = null;
    if (
      youtubeProvider?.lastSuccessAt &&
      youtubeProvider.lastSuccessAt >= hoursAgo(now, RULES.youtubeFreshHours)
    ) {
      const ytRows = await db.execute<{ title: string; rank: number }>(sql`
        select title, rank from youtube_videos
        where provider_id = ${youtubeProvider.id}
          and observed_at = (
            select max(observed_at) from youtube_videos
            where provider_id = ${youtubeProvider.id}
              and observed_at >= ${hoursAgo(now, RULES.youtubeFreshHours).toISOString()}
              and observed_at <= ${now.toISOString()}
          )
      `);
      if (ytRows.length > 0)
        youtube = ytRows.map((r) => ({ title: r.title, rank: Number(r.rank) }));
    }

    const trends = compileTrends(
      trendRows.map((r) => ({
        ...r,
        observed_at: r.observed_at instanceof Date ? r.observed_at : new Date(r.observed_at),
      })),
      now,
      trendsAvailable,
    ).filter((t) => t.tokens.length > 0);

    const categoryIds = new Map(
      (await db.select({ id: categories.id, slug: categories.slug }).from(categories)).map((c) => [
        c.slug,
        c.id,
      ]),
    );
    const categoryId = (slug: string) => categoryIds.get(slug) ?? categoryIds.get("diger")!;

    const clusters = clusterItems(items);
    result.clusters = clusters.length;

    const processed = new Set<string>();
    const visible: {
      kind: "trend" | "news";
      snapshotId: number;
      topicId: string;
      score: number | null;
      /** Aramayı açıklayan en az bir haberi var mı (sitedeki sıralama ile aynı kural) */
      explained: boolean;
    }[] = [];
    const claimedClusters = new Set<Cluster>();

    // ══ 1) Trend konuları ══
    const existingTrendTopics = trends.length
      ? await db
          .select({
            id: topics.id,
            trendKey: topics.trendKey,
            title: topics.title,
            status: topics.status,
            publishedAt: topics.publishedAt,
            summaryOrigin: topics.summaryOrigin,
            categoryId: topics.categoryId,
            reasons: topics.reasons,
          })
          .from(topics)
          .where(
            and(
              eq(topics.kind, "trend"),
              eq(topics.isMock, false),
              inArray(
                topics.trendKey,
                trends.map((t) => t.key),
              ),
            ),
          )
      : [];
    const trendTopicByKey = new Map(existingTrendTopics.map((t) => [t.trendKey!, t]));

    /** Filtreye takılan aramanın konusu gizlenir (filtre değişirse geri açılabilsin diye işaretli) */
    const hideFiltered = async (
      existing: { id: string; status: string } | undefined,
      label: string,
    ) => {
      result.filtered++;
      if (!existing) return;
      processed.add(existing.id);
      if (existing.status === "hidden") return;
      await db
        .update(topics)
        .set({ status: "hidden", reasons: [`${FILTER_MARK}${label}`], updatedAt: now })
        .where(eq(topics.id, existing.id));
    };

    for (const trend of trends) {
      const existing = trendTopicByKey.get(trend.key);
      // Listeden çıkmış ve hiç konu açılmamış terim için konu açılmaz
      if (!existing && !trend.current) continue;

      // Gündem başlığı olamayacak aramalar (site adı, canlı yayın, hava durumu…) hiç konu olmaz
      const verdict = classifyTerm(trend.term);
      if (verdict.verdict === "exclude") {
        await hideFiltered(existing, FILTER_REASON_LABELS[verdict.reason!]);
        continue;
      }

      // Google'ın "ilgili haberleri" + Google Haberler aramasında bulunanlar; bazen alakasızdır:
      // yalnızca başlığında terim geçenler kullanılır
      const seenUrls = new Set<string>();
      trend.related = [...trend.related, ...(searchNews.get(trend.key) ?? [])]
        .filter((r) => headlineExplainsTerm(r.title, trend.term))
        .filter((r) => !seenUrls.has(r.url) && seenUrls.add(r.url))
        .slice(0, 15);
      const cluster = bestClusterForTrend(clusters, trend);
      const newsItems = cluster?.items ?? [];
      // Aramayı açıklayan haber yoksa (bu çalıştırmada ya da daha önce bağlanmış) listelenmez;
      // haber bulununca konu açılır / yeniden görünür
      // Önce eski kurallarla bağlanmış uymayan "ilgili haberler" çıkarılır (başlığında terim geçmeyen
      // veya Türkçe olmayan), sonra konunun açıklaması olup olmadığına bakılır
      if (existing && trendsProvider) {
        const linkedRelated = await db
          .select({ id: sourceItems.id, title: sourceItems.title })
          .from(topicItems)
          .innerJoin(sourceItems, eq(sourceItems.id, topicItems.sourceItemId))
          .where(
            and(eq(topicItems.topicId, existing.id), eq(sourceItems.providerId, trendsProvider.id)),
          );
        const stale = linkedRelated
          .filter((r) => !headlineExplainsTerm(r.title, trend.term))
          .map((r) => r.id);
        if (stale.length) {
          await db
            .delete(topicItems)
            .where(
              and(eq(topicItems.topicId, existing.id), inArray(topicItems.sourceItemId, stale)),
            );
        }
      }
      let hasNews = newsItems.length > 0 || trend.related.length > 0;
      if (!hasNews && existing) {
        const [linked] = await db
          .select({ n: sql<number>`count(*)::int` })
          .from(topicItems)
          .where(eq(topicItems.topicId, existing.id));
        hasNews = (linked?.n ?? 0) > 0;
      }
      if (!hasNews) {
        await hideFiltered(existing, FILTER_REASON_LABELS.no_news);
        continue;
      }
      if (cluster) claimedClusters.add(cluster);
      if (trend.current) result.trends++;

      await db.transaction(async (tx) => {
        let topicId = existing?.id;
        let current: Status = (existing?.status as Status | undefined) ?? "candidate";
        // Daha önce filtreyle gizlenmiş ama artık geçen arama yeniden açılır (elle gizlenen açılmaz)
        if (current === "hidden" && existing?.reasons[0]?.startsWith(FILTER_MARK)) {
          current = existing.publishedAt ? "published" : "candidate";
        }
        if (!topicId) {
          const title = displayTerm(trend.term, [
            ...newsItems.map((i) => i.title),
            ...trend.related.map((r) => r.title),
          ]);
          const [created] = await tx
            .insert(topics)
            .values({
              slug: await uniqueSlug(db, title),
              title,
              kind: "trend",
              trendKey: trend.key,
              categoryId: categoryId(
                inferCategory([...newsItems.map((i) => i.url), ...trend.related.map((r) => r.url)]),
              ),
              summary: null,
              reasons: [],
              status: "candidate",
              summaryOrigin: "none",
              isMock: false,
              firstSeenAt: trend.firstObservedAt,
            })
            .onConflictDoNothing()
            .returning({ id: topics.id });
          if (!created) return; // eşzamanlı başka bir çalıştırma oluşturdu
          topicId = created.id;
          result.created++;
          await tx
            .insert(timelineEvents)
            .values({ topicId, occurredAt: trend.firstObservedAt, type: "trend_listed" });
        }
        processed.add(topicId);

        // Açıklayıcı haberleri bağla: eşleşen küme + Google'ın ilgili haberleri
        if (newsItems.length) {
          await tx
            .insert(topicItems)
            .values(newsItems.map((i) => ({ topicId: topicId!, sourceItemId: i.id, addedAt: now })))
            .onConflictDoNothing();
        }
        if (trend.related.length && trendsProvider) {
          await tx
            .insert(sourceItems)
            .values(
              trend.related.map((r) => ({
                providerId: trendsProvider.id,
                publisherId: null,
                sourceName: r.source.slice(0, 96) || null,
                url: r.url,
                urlHash: urlHash(r.url),
                title: r.title.slice(0, 300),
                publishedAt: null,
                fetchedAt: trend.lastObservedAt,
              })),
            )
            .onConflictDoNothing({ target: sourceItems.urlHash });
          const relatedIds = await tx
            .select({ id: sourceItems.id })
            .from(sourceItems)
            .where(
              inArray(
                sourceItems.urlHash,
                trend.related.map((r) => urlHash(r.url)),
              ),
            );
          if (relatedIds.length) {
            await tx
              .insert(topicItems)
              .values(
                relatedIds.map((r) => ({ topicId: topicId!, sourceItemId: r.id, addedAt: now })),
              )
              .onConflictDoNothing();
          }
        }
        if (current === "hidden") return;

        const status = nextTrendStatus(current, trend, now);
        // Başlık hâlâ otomatik baş harf büyütmesiyse ve haberlerden doğru yazım öğrenildiyse düzelt ("Aöf" → "AÖF")
        const learnedTitle = displayTerm(trend.term, [
          ...newsItems.map((i) => i.title),
          ...trend.related.map((r) => r.title),
        ]);
        const titleUpdate =
          existing && existing.title === displayTerm(trend.term) && learnedTitle !== existing.title
            ? { title: learnedTitle }
            : {};
        const categoryUpdate =
          existing && existing.categoryId === categoryId("diger")
            ? {
                categoryId: categoryId(
                  inferCategory([
                    ...newsItems.map((i) => i.url),
                    ...trend.related.map((r) => r.url),
                  ]),
                ),
              }
            : {};
        await tx
          .update(topics)
          .set({
            ...titleUpdate,
            ...categoryUpdate,
            ...((existing?.summaryOrigin ?? "none") === "none"
              ? { reasons: trendReasons(trend, newsItems, now, youtube) }
              : {}),
            status,
            ...(status === "published" && !existing?.publishedAt ? { publishedAt: now } : {}),
            updatedAt: now,
          })
          .where(eq(topics.id, topicId));

        if (status === "archived") {
          result.archived++;
          return;
        }
        if (
          status === "cooling" &&
          current === "published" &&
          !(await hasEvent(tx, topicId, "trend_left"))
        ) {
          await tx
            .insert(timelineEvents)
            .values({ topicId, occurredAt: trend.lastObservedAt, type: "trend_left" });
        }
        if (distinctPublishers(newsItems) >= 3 && !(await hasEvent(tx, topicId, "news_spread"))) {
          await tx.insert(timelineEvents).values({ topicId, occurredAt: now, type: "news_spread" });
        }

        const snap = await writeSnapshot(
          tx,
          topicId,
          now,
          scoreTrend(trend, newsItems, now, { publisherTotal, trendsAvailable, youtube }),
        );
        if (snap) {
          result.snapshots++;
          const [linked] = await tx
            .select({ n: sql<number>`count(*)::int` })
            .from(topicItems)
            .where(eq(topicItems.topicId, topicId));
          visible.push({
            kind: "trend",
            snapshotId: snap.id,
            topicId,
            score: snap.score,
            explained: (linked?.n ?? 0) > 0,
          });
        }
        if (status === "published") result.published++;
        if (status === "cooling") result.cooling++;
      });
    }

    // ══ 2) Haber konuları: hiçbir aramayla eşleşmeyen kümeler ══
    const newsIds = clusters.map((c) => c.topicId).filter((id): id is string => id !== null);
    const existingNews = newsIds.length
      ? await db
          .select({
            id: topics.id,
            status: topics.status,
            publishedAt: topics.publishedAt,
            summaryOrigin: topics.summaryOrigin,
          })
          .from(topics)
          .where(inArray(topics.id, newsIds))
      : [];
    const newsById = new Map(existingNews.map((t) => [t.id, t]));

    for (const cluster of clusters) {
      const publishersCount = distinctPublishers(cluster.items);
      const claimed = claimedClusters.has(cluster);
      if (!cluster.topicId && (claimed || publishersCount < RULES.minPublishersToCreate)) continue;

      const lastItemAt = cluster.items.reduce(
        (max, i) => (i.at > max ? i.at : max),
        cluster.items[0]!.at,
      );
      const firstItemAt = cluster.items.reduce(
        (min, i) => (i.at < min ? i.at : min),
        cluster.items[0]!.at,
      );

      await db.transaction(async (tx) => {
        let topicId = cluster.topicId;
        const existing = topicId ? newsById.get(topicId) : undefined;
        const current: Status = (existing?.status as Status | undefined) ?? "candidate";

        if (!topicId) {
          const title = calmTitle(representative(cluster).title);
          const [created] = await tx
            .insert(topics)
            .values({
              slug: await uniqueSlug(db, title),
              title,
              kind: "news",
              categoryId: categoryId(inferCategory(cluster.items.map((i) => i.url))),
              summary: null,
              reasons: [],
              status: "candidate",
              summaryOrigin: "none",
              isMock: false,
              firstSeenAt: firstItemAt,
            })
            .returning({ id: topics.id });
          topicId = created!.id;
          result.created++;
          await tx.insert(timelineEvents).values({
            topicId,
            occurredAt: firstItemAt,
            type: "first_source",
            sourceItemId:
              cluster.items.find((i) => i.at.getTime() === firstItemAt.getTime())?.id ?? null,
          });
        }
        processed.add(topicId);

        const newLinks = cluster.items.filter((i) => i.topicId === null);
        if (newLinks.length) {
          await tx
            .insert(topicItems)
            .values(newLinks.map((i) => ({ topicId: topicId!, sourceItemId: i.id, addedAt: now })))
            .onConflictDoNothing();
        }
        if (current === "hidden") return;

        // Bir aramayla eşleşen küme artık trend konusunda gösterilir; haber konusu geri çekilir
        const status: Status = claimed
          ? current === "candidate"
            ? "candidate"
            : "archived"
          : nextNewsStatus(current, { lastItemAt, publishers: publishersCount, now });

        const candidateUpdates =
          current === "candidate"
            ? {
                title: calmTitle(representative(cluster).title),
                categoryId: categoryId(inferCategory(cluster.items.map((i) => i.url))),
              }
            : {};
        await tx
          .update(topics)
          .set({
            ...candidateUpdates,
            ...((existing?.summaryOrigin ?? "none") === "none"
              ? { reasons: newsReasons(cluster.items, now) }
              : {}),
            status,
            ...(status === "published" && !existing?.publishedAt ? { publishedAt: now } : {}),
            updatedAt: now,
          })
          .where(eq(topics.id, topicId));
        if (status === "archived") {
          result.archived++;
          return;
        }
        if (status === "candidate") return;

        if (publishersCount >= 3 && !(await hasEvent(tx, topicId, "news_spread"))) {
          const sorted = [...cluster.items].sort((a, b) => a.at.getTime() - b.at.getTime());
          const seen = new Set<number | null>();
          const third = sorted.find((i) => (seen.add(i.publisherId), seen.size === 3));
          await tx.insert(timelineEvents).values({
            topicId,
            occurredAt: third?.at ?? now,
            type: "news_spread",
            sourceItemId: third?.id ?? null,
          });
        }
        const snap = await writeSnapshot(
          tx,
          topicId,
          now,
          scoreCluster(cluster.items, now, { publisherTotal, trendsAvailable }),
        );
        if (snap) {
          result.snapshots++;
          visible.push({
            kind: "news",
            snapshotId: snap.id,
            topicId,
            score: snap.score,
            explained: true,
          });
        }
        if (status === "published") result.published++;
        if (status === "cooling") result.cooling++;
      });
    }

    // ══ 3) Bu çalıştırmada hiç verisi kalmamış konular arşive ══
    const stale = await db
      .update(topics)
      .set({ status: "archived", updatedAt: now })
      .where(
        and(
          eq(topics.isMock, false),
          inArray(topics.status, ["candidate", "published", "cooling"]),
          processed.size ? notInArray(topics.id, [...processed]) : sql`true`,
        ),
      )
      .returning({ id: topics.id });
    result.archived += stale.length;

    // ══ 4) Sıralama (tür bazında) ve "ilk 5'e girdi" ══
    for (const kind of ["trend", "news"] as const) {
      const ranked = visible
        .filter((s) => s.kind === kind && s.score !== null)
        // Sitedeki sıralamayla aynı: önce haberle açıklananlar, sonra skora göre
        .sort(
          (a, b) => Number(b.explained) - Number(a.explained) || (b.score ?? 0) - (a.score ?? 0),
        );
      for (const [i, s] of ranked.entries()) {
        const rank = i + 1;
        await db.update(topicSnapshots).set({ rank }).where(eq(topicSnapshots.id, s.snapshotId));
        if (kind === "trend" && rank <= 5) {
          const [had] = await db
            .select({ id: timelineEvents.id })
            .from(timelineEvents)
            .where(
              and(eq(timelineEvents.topicId, s.topicId), eq(timelineEvents.type, "entered_top5")),
            )
            .limit(1);
          if (!had)
            await db
              .insert(timelineEvents)
              .values({ topicId: s.topicId, occurredAt: now, type: "entered_top5" });
        }
      }
    }

    log.info(result, "gündem konuları güncellendi");
    return result;
  } finally {
    await conn`select pg_advisory_unlock(hashtext('topics:build'))`.catch(() => {});
    conn.release();
  }
}
