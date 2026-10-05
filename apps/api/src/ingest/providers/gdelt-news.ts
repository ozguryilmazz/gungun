import { publishers } from "@gundemci/db";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { SafeFetchError } from "../../lib/safe-http.ts";
import { FeedParseError } from "../feed-parser.ts";
import { runTrendNewsSearch, type SearchResultItem } from "../news-search.ts";
import { cleanText, normalizeUrl } from "../normalize.ts";
import type { IngestProvider, ProviderContext } from "../types.ts";

const HOST = "api.gdeltproject.org";

/**
 * GDELT DOC 2.0 API: son 1 günün TÜRKÇE haberlerinde arama (sıra: en yeni).
 * Çok kelimeli terim tırnak içinde (tam ifade) aranır.
 */
export function gdeltSearchUrl(term: string): string {
  const q = term.trim().includes(" ") ? `"${term.trim()}"` : term.trim();
  const params = new URLSearchParams({
    query: `${q} sourcelang:turkish`,
    mode: "artlist",
    format: "json",
    maxrecords: "25",
    timespan: "1d",
    sort: "datedesc",
  });
  return `https://${HOST}/api/v2/doc/doc?${params}`;
}

const ArticleSchema = z.object({
  url: z.string(),
  title: z.string(),
  seendate: z.string().optional(),
  domain: z.string().optional(),
});
const ResponseSchema = z.object({ articles: z.array(z.unknown()).max(250).optional() });

/** "20261005T123000Z" → Date */
export function parseSeenDate(raw: string | undefined): Date | null {
  const m = raw ? /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(raw) : null;
  if (!m) return null;
  const d = new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Alan adını bilinen yayıncı adına çevirir ("www.hurriyet.com.tr" → "Hürriyet"); bilinmiyorsa alan adı */
export function sourceName(domain: string | undefined, known: Map<string, string>): string | null {
  const host = domain
    ?.toLowerCase()
    .replace(/^www\./, "")
    .trim();
  if (!host) return null;
  for (const [d, name] of known) if (host === d || host.endsWith(`.${d}`)) return name;
  return host.slice(0, 96);
}

/**
 * GDELT yanıtını doğrular. GDELT hata ve sınır uyarılarını JSON yerine düz metin (HTTP 200) döndürür:
 * sınır uyarısı 429 gibi ele alınır (o çalışma durur), diğerleri ayrıştırma hatasıdır.
 */
export function parseGdelt(body: Buffer, known: Map<string, string>): SearchResultItem[] {
  const text = body.toString("utf8").trim();
  if (!text.startsWith("{")) {
    if (/limit requests/i.test(text)) throw new SafeFetchError("http_error", "HTTP 429", 429);
    throw new FeedParseError(`GDELT: ${text.slice(0, 80)}`);
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new FeedParseError("GDELT yanıtı okunamadı");
  }
  const parsed = ResponseSchema.safeParse(json);
  if (!parsed.success) throw new FeedParseError("GDELT: beklenmeyen yanıt biçimi");
  const out: SearchResultItem[] = [];
  for (const raw of parsed.data.articles ?? []) {
    const a = ArticleSchema.safeParse(raw);
    if (!a.success) continue;
    const url = normalizeUrl(a.data.url);
    const title = cleanText(a.data.title);
    if (!url || !title) continue;
    out.push({
      title,
      url,
      source: sourceName(a.data.domain, known),
      publishedAt: parseSeenDate(a.data.seendate),
    });
  }
  return out;
}

/**
 * GDELT Project (herkese açık, ücretsiz haber veritabanı) ile trend aramaları AÇIKLAYAN haberler.
 * GDELT en fazla 5 saniyede bir istek ister: istekler arasında 5,5 sn beklenir.
 */
export const gdeltNewsProvider: IngestProvider = {
  key: "gdelt_news",

  async run(ctx: ProviderContext) {
    const known = new Map(
      (
        await ctx.db
          .select({ domain: publishers.domain, name: publishers.name })
          .from(publishers)
          .where(eq(publishers.isMock, false))
      ).map((p) => [p.domain.toLowerCase(), p.name]),
    );
    return runTrendNewsSearch(ctx, {
      label: "GDELT",
      host: HOST,
      searchUrl: gdeltSearchUrl,
      parse: (body) => parseGdelt(body, known),
      accept: "application/json",
      defaults: { delayMs: 5500, maxTerms: 15, perTermMinutes: 60 },
      // GDELT 3 harften kısa aramaları kabul etmez
      skipTerm: (term) => term.trim().length < 3,
    });
  },
};
