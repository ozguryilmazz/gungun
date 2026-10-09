// Haber sitesi ve RSS keşfi için saf yardımcılar (ağ yok; test edilebilir).
// Yalnızca bağlantıları ve <link rel="alternate"> etiketlerini okur; sayfa içeriği saklanmaz.

/** Haber sitesi olmayan, dizinlerde sık görülen alan adları */
const NOT_NEWS = [
  "facebook.com",
  "twitter.com",
  "x.com",
  "instagram.com",
  "youtube.com",
  "youtu.be",
  "tiktok.com",
  "linkedin.com",
  "pinterest.com",
  "whatsapp.com",
  "t.me",
  "telegram.org",
  "google.com",
  "goo.gl",
  "apple.com",
  "microsoft.com",
  "wikipedia.org",
  "wordpress.com",
  "blogspot.com",
  "amazon.com",
  "bit.ly",
];

const host = (u: URL) => u.hostname.toLowerCase().replace(/^www\./, "");
const isNotNews = (h: string) => NOT_NEWS.some((d) => h === d || h.endsWith(`.${d}`));

/** Bir sayfadaki <a href> bağlantılarından sayfanın kendisi dışındaki sitelerin ana sayfaları */
export function extractExternalSites(html: string, pageUrl: string, limit = 300): string[] {
  const own = host(new URL(pageUrl));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of html.matchAll(/<a\b[^>]*?\bhref\s*=\s*["']([^"'#]+)["']/gi)) {
    let u: URL;
    try {
      u = new URL(m[1]!, pageUrl);
    } catch {
      continue;
    }
    if (u.protocol !== "https:" && u.protocol !== "http:") continue;
    const h = host(u);
    if (!h.includes(".") || h === own || h.endsWith(`.${own}`) || isNotNews(h) || seen.has(h))
      continue;
    seen.add(h);
    out.push(`https://${u.hostname.toLowerCase()}/`);
    if (out.length >= limit) break;
  }
  return out;
}

/** Ana sayfadaki RSS/Atom bağlantıları (<link rel="alternate" type="application/rss+xml">) */
export function findFeedLinks(html: string, pageUrl: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
    const tag = m[0];
    if (!/rel\s*=\s*["'][^"']*alternate/i.test(tag)) continue;
    if (!/type\s*=\s*["']application\/(rss|atom)\+xml["']/i.test(tag)) continue;
    const href = /href\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1];
    if (!href) continue;
    try {
      const u = new URL(href.replace(/&amp;/g, "&"), pageUrl);
      if ((u.protocol === "https:" || u.protocol === "http:") && !out.includes(u.toString()))
        out.push(u.toString());
    } catch {
      // geçersiz adres
    }
  }
  return out;
}

/** <title> içeriği (site adı tahmini için), en fazla 80 karakter */
export function pageTitle(html: string): string | null {
  const t = /<title[^>]*>([^<]{1,300})<\/title>/i.exec(html)?.[1];
  if (!t) return null;
  const clean = t
    .replace(/&amp;/g, "&")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
  // "Son Dakika Haberler - Site Adı" → kısa olan parça çoğu zaman site adıdır
  const parts = clean
    .split(/\s[|–-]\s/)
    .map((p) => p.trim())
    .filter(Boolean);
  const name = parts.length > 1 ? parts.reduce((a, b) => (b.length < a.length ? b : a)) : clean;
  return name.slice(0, 80) || null;
}

/** Ana sayfada RSS etiketi yoksa denenecek yaygın adresler */
export const COMMON_FEED_PATHS = [
  "/rss",
  "/rss.xml",
  "/feed",
  "/rss/anasayfa.xml",
  "/rss/gundem.xml",
  "/rss/sondakika.xml",
  "/export/rss",
  "/service/rss.php",
];
