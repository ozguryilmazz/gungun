// RSS 2.0 / RSS 1.0 (RDF) / Atom ve Google Trends RSS ayrıştırıcı.
// Güvenlik: DTD/ENTITY içeren belgeler reddedilir (XXE, "billion laughs"); yalnızca
// başlık, bağlantı ve tarih alınır; haber gövdesi okunmaz/saklanmaz.
import { XMLParser } from "fast-xml-parser";
import { cleanText, normalizeUrl, parseApproxTraffic, parseDate } from "./normalize.ts";

export class FeedParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FeedParseError";
  }
}

export interface FeedItem {
  title: string;
  url: string;
  publishedAt: Date | null;
}

export interface TrendItem {
  term: string;
  approxTraffic: number | null;
  publishedAt: Date | null;
  related: { title: string; url: string; source: string }[];
}

const MAX_ITEMS = 200;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  removeNSPrefix: true,
  parseTagValue: false,
  trimValues: true,
  processEntities: { enabled: true, maxEntityCount: 0, maxTotalExpansions: 10_000 },
  htmlEntities: true,
  isArray: (name) => ["item", "entry", "link", "news_item"].includes(name),
});

const asArray = <T>(v: T | T[] | undefined): T[] =>
  v === undefined ? [] : Array.isArray(v) ? v : [v];

/** Metin düğümü: "abc" | { "#text": "abc" } | sayı */
function text(node: unknown): string {
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  if (node && typeof node === "object" && "#text" in node)
    return text((node as Record<string, unknown>)["#text"]);
  return "";
}

function decodeBody(body: Buffer, contentType: string): string {
  const fromHeader = /charset=([\w-]+)/i.exec(contentType)?.[1];
  const head = body.subarray(0, 200).toString("latin1");
  const fromXml = /<\?xml[^>]*encoding=["']([\w-]+)["']/i.exec(head)?.[1];
  const charset = (fromHeader ?? fromXml ?? "utf-8").toLowerCase();
  try {
    return new TextDecoder(charset).decode(body);
  } catch {
    return new TextDecoder("utf-8").decode(body);
  }
}

function parseXml(body: Buffer, contentType: string): Record<string, unknown> {
  const xml = decodeBody(body, contentType);
  if (/<!DOCTYPE|<!ENTITY/i.test(xml))
    throw new FeedParseError("DTD/ENTITY içeren belge reddedildi");
  let doc: unknown;
  try {
    doc = parser.parse(xml);
  } catch (error) {
    throw new FeedParseError(
      `XML ayrıştırılamadı: ${error instanceof Error ? error.message.slice(0, 120) : ""}`,
    );
  }
  if (!doc || typeof doc !== "object") throw new FeedParseError("Boş belge");
  return doc as Record<string, unknown>;
}

/**
 * Bir öğenin bağlantı adayları, öncelik sırasıyla: <link> metni veya href özniteliği
 * (Atom / atom:link), ardından feedburner origLink ve mutlak adresli <guid>.
 */
function linkCandidates(raw: Record<string, unknown>): { value: string; allowRelative: boolean }[] {
  const out: { value: string; allowRelative: boolean }[] = [];
  for (const l of asArray(raw.link as unknown)) {
    if (typeof l === "string" || typeof l === "number") {
      out.push({ value: String(l), allowRelative: true });
    } else if (l && typeof l === "object") {
      const node = l as Record<string, unknown>;
      const rel = node["@_rel"];
      if (typeof node["@_href"] === "string") {
        if (rel === undefined || rel === "alternate")
          out.push({ value: node["@_href"], allowRelative: true });
      } else if (text(node)) {
        out.push({ value: text(node), allowRelative: true });
      }
    }
  }
  // guid çoğu zaman bir kimliktir (ör. "7673337"); yalnızca mutlak adresse kullanılır
  for (const v of [text(raw.origLink), text(raw.guid)])
    if (v) out.push({ value: v, allowRelative: false });
  return out;
}

/** Göreli bağlantıyı ("/gundem/haber-1") feed'in kendi adresine göre mutlak adrese çevirir */
function resolveLink(
  candidate: { value: string; allowRelative: boolean },
  baseUrl?: string,
): string | null {
  const value = candidate.value.trim();
  const absolute = normalizeUrl(value);
  if (absolute) return absolute;
  if (!candidate.allowRelative || !baseUrl || !value.startsWith("/") || value.startsWith("//"))
    return null;
  try {
    return normalizeUrl(new URL(value, baseUrl).toString());
  } catch {
    return null;
  }
}

export function parseFeed(
  body: Buffer,
  contentType = "",
  now = new Date(),
  /** Göreli bağlantılar için feed'in (yönlendirme sonrası) adresi */
  baseUrl?: string,
): FeedItem[] {
  const doc = parseXml(body, contentType);
  let rawItems: Record<string, unknown>[];

  const rss = doc.rss as Record<string, unknown> | undefined;
  const rdf = doc.RDF as Record<string, unknown> | undefined;
  const feed = doc.feed as Record<string, unknown> | undefined;
  if (rss) {
    rawItems = asArray(
      (rss.channel as Record<string, unknown> | undefined)?.item as Record<string, unknown>[],
    );
  } else if (rdf) {
    rawItems = asArray(rdf.item as Record<string, unknown>[]);
  } else if (feed) {
    rawItems = asArray(feed.entry as Record<string, unknown>[]);
  } else {
    throw new FeedParseError("RSS/Atom belgesi değil");
  }

  const items: FeedItem[] = [];
  for (const raw of rawItems.slice(0, MAX_ITEMS)) {
    const title = cleanText(text(raw.title));
    let url: string | null = null;
    for (const candidate of linkCandidates(raw)) {
      url = resolveLink(candidate, baseUrl);
      if (url) break;
    }
    if (!title || !url) continue;
    const date = text(raw.pubDate) || text(raw.date) || text(raw.published) || text(raw.updated);
    items.push({ title, url, publishedAt: parseDate(date, now) });
  }
  return items;
}

export function parseTrends(body: Buffer, contentType = "", now = new Date()): TrendItem[] {
  const doc = parseXml(body, contentType);
  const channel = (doc.rss as Record<string, unknown> | undefined)?.channel as
    Record<string, unknown> | undefined;
  if (!channel) throw new FeedParseError("Trend RSS belgesi değil");

  const out: TrendItem[] = [];
  for (const raw of asArray(channel.item as Record<string, unknown>[]).slice(0, MAX_ITEMS)) {
    const term = cleanText(text(raw.title), 200);
    if (!term) continue;
    const related = asArray(raw.news_item as Record<string, unknown>[])
      .slice(0, 5)
      .map((n) => ({
        title: cleanText(text(n.news_item_title)),
        url: normalizeUrl(text(n.news_item_url)) ?? "",
        source: cleanText(text(n.news_item_source), 96),
      }))
      .filter((n) => n.title && n.url);
    out.push({
      term,
      approxTraffic: parseApproxTraffic(text(raw.approx_traffic)),
      publishedAt: parseDate(text(raw.pubDate), now),
      related,
    });
  }
  return out;
}
