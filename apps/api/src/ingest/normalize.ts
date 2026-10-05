import { createHash } from "node:crypto";

const TRACKING_PARAMS = /^(utm_[a-z]+|fbclid|gclid|yclid|mc_cid|mc_eid|ref|ref_src|_ga|igshid)$/i;

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

/** Feed'lerde sık görülen çift kodlanmış HTML karakterlerini bir kez çözer */
function decodeEntities(input: string): string {
  return input.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]{2,6});/gi, (match, code: string) => {
    if (code[0] === "#") {
      const n =
        code[1] === "x" || code[1] === "X"
          ? parseInt(code.slice(2), 16)
          : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : " ";
    }
    return NAMED_ENTITIES[code.toLowerCase()] ?? match;
  });
}

/**
 * Kaynak başlığını düz, güvenli metne indirger: HTML etiketleri ve kontrol karakterleri
 * atılır, boşluklar sadeleşir, uzunluk sınırlanır. Sonuç asla HTML olarak işlenmez.
 */
export function cleanText(input: unknown, maxLength = 300): string {
  if (typeof input !== "string") return "";
  const text = decodeEntities(input)
    .replace(/<!\[CDATA\[|\]\]>/g, "")
    .replace(/<[^>]*>/g, " ")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069\ufeff]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1).trimEnd()}…`;
}

/** URL'yi tekrar kayıt tespiti için normalleştirir; http(s) değilse null */
export function normalizeUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.username || url.password) return null;
  url.hash = "";
  url.hostname = url.hostname.toLowerCase();
  for (const key of [...url.searchParams.keys()]) {
    if (TRACKING_PARAMS.test(key)) url.searchParams.delete(key);
  }
  const out = url.toString();
  return out.length > 2048 ? null : out;
}

export function urlHash(normalizedUrl: string): string {
  return createHash("sha256").update(normalizedUrl).digest("hex");
}

/** host, alan adının kendisi veya alt alan adı mı? (ör. www.ntv.com.tr → ntv.com.tr) */
export function hostBelongsTo(host: string, domain: string): boolean {
  const h = host.toLowerCase();
  const d = domain.toLowerCase();
  return h === d || h.endsWith(`.${d}`);
}

/** RSS/Atom tarihini çözer; geçersizse veya 1 saatten fazla gelecekteyse null */
export function parseDate(raw: unknown, now: Date = new Date()): Date | null {
  if (typeof raw !== "string" || raw.trim() === "") return null;
  const date = new Date(raw.trim());
  if (Number.isNaN(date.getTime())) return null;
  if (date.getTime() > now.getTime() + 3_600_000) return null;
  if (date.getFullYear() < 2000) return null;
  return date;
}

/** "2.000+" / "20,000+" / "500+" → sayı; çözülemezse null */
export function parseApproxTraffic(raw: unknown): number | null {
  if (typeof raw !== "string" && typeof raw !== "number") return null;
  const digits = String(raw).replace(/[^\d]/g, "");
  if (digits === "") return null;
  const n = Number(digits);
  return Number.isSafeInteger(n) && n <= 2_000_000_000 ? n : null;
}
