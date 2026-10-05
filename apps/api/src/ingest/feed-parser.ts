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

function atomLink(links: unknown): string {
  for (const l of asArray(links as Record<string, unknown> | Record<string, unknown>[])) {
    if (typeof l === "string") return l;
    const rel = l["@_rel"];
    if ((rel === undefined || rel === "alternate") && typeof l["@_href"] === "string")
      return l["@_href"];
  }
  return "";
}

export function parseFeed(body: Buffer, contentType = "", now = new Date()): FeedItem[] {
  const doc = parseXml(body, contentType);
  let rawItems: Record<string, unknown>[];
  let kind: "rss" | "atom";

  const rss = doc.rss as Record<string, unknown> | undefined;
  const rdf = doc.RDF as Record<string, unknown> | undefined;
  const feed = doc.feed as Record<string, unknown> | undefined;
  if (rss) {
    kind = "rss";
    rawItems = asArray(
      (rss.channel as Record<string, unknown> | undefined)?.item as Record<string, unknown>[],
    );
  } else if (rdf) {
    kind = "rss";
    rawItems = asArray(rdf.item as Record<string, unknown>[]);
  } else if (feed) {
    kind = "atom";
    rawItems = asArray(feed.entry as Record<string, unknown>[]);
  } else {
    throw new FeedParseError("RSS/Atom belgesi değil");
  }

  const items: FeedItem[] = [];
  for (const raw of rawItems.slice(0, MAX_ITEMS)) {
    const title = cleanText(text(raw.title));
    const link =
      kind === "atom"
        ? atomLink(raw.link)
        : text(asArray(raw.link as unknown[])[0]) || text(raw.guid);
    const url = normalizeUrl(link);
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
