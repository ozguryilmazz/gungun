// Google trend aramalarından GÜNDEM BAŞLIĞI OLAMAYACAKLARI ayıran kural tabanlı filtre (yapay zekâ yok).
//
//  - exclude:    hiç konu olmaz (siteye gitmek için arama, canlı yayın, hava durumu, yasa dışı, yabancı dil…)
//  - needs_news: yalnızca aramayı AÇIKLAYAN bir haber varsa konu olur (tek kelimelik genel aramalar)
//  - keep:       normal trend konusu
//
// Elenen aramalar silinmez: trend_signals'ta kalır; `pnpm trends:filter` ile neden elendiği görülür.
// Liste ileride admin panelinden düzenlenebilir hâle gelecek (aşama 10).
import { isMediaTerm } from "./text.ts";

export type FilterReason =
  | "site_or_brand"
  | "live_stream"
  | "routine_service"
  | "illegal"
  | "foreign_language"
  | "date_or_weekday"
  | "single_word";

export interface TermVerdict {
  verdict: "keep" | "exclude" | "needs_news";
  reason: FilterReason | null;
}

export const FILTER_REASON_LABELS: Record<FilterReason, string> = {
  site_or_brand: "Siteye/uygulamaya gitmek için yapılan arama",
  live_stream: "Canlı yayın araması",
  routine_service: "Her gün tekrarlanan hizmet araması (hava durumu, vakit, fiyat…)",
  illegal: "Yasa dışı bahis veya korsan yayın",
  foreign_language: "Yabancı dilde arama",
  date_or_weekday: "Tarih veya gün adı",
  single_word: "Tek kelimelik genel arama (yalnızca haberle açıklanırsa gösterilir)",
};

const normalize = (term: string) => term.toLocaleLowerCase("tr-TR").trim().replace(/\s+/g, " ");

/** Siteler, uygulamalar, markalar, kanallar (medya adları text.ts'teki listeden de gelir) */
const SITES_AND_BRANDS = new Set([
  // haber siteleri ve gazeteler
  "memurlar",
  "memurlar net",
  "memurlar.net",
  "mynet",
  "haber7",
  "ensonhaber",
  "en son haber",
  "son dakika",
  "son dakika haberi",
  "son dakika haberleri",
  "haberler",
  "haberler.com",
  "haber",
  "gazete",
  "gazeteler",
  "gazete oku",
  "gazete manşetleri",
  "sözcü gazetesi",
  "t24",
  "bloomberg",
  "bloomberg ht",
  "odatv",
  "yeni akit",
  "akit",
  "takvim",
  "posta",
  "star",
  "yeni şafak",
  "karar",
  "korkusuz",
  "birgün",
  "evrensel",
  "diken",
  "medyascope",
  "independent türkçe",
  "euronews",
  "ensonhaber.com",
  // kanallar
  "trt spor",
  "trt 2",
  "trt belgesel",
  "trt çocuk",
  "kbs",
  "show tv",
  "star tv",
  "kanal d",
  "kanald",
  "atv",
  "fox",
  "fox tv",
  "now",
  "now tv",
  "tv8",
  "tv 8",
  "tv100",
  "tv 100",
  "a spor",
  "a para",
  "beyaz tv",
  "teve2",
  "dmax",
  "tlc",
  "bein sports",
  "s sport",
  "exxen",
  "tabii",
  "tivibu",
  "tivibu spor",
  "tv plus",
  "tod",
  "netflix",
  "disney plus",
  "blutv",
  "gain",
  // site ve uygulamalar
  "trendyol",
  "hepsiburada",
  "amazon",
  "n11",
  "sahibinden",
  "letgo",
  "dolap",
  "yemeksepeti",
  "getir",
  "migros",
  "a101",
  "bim",
  "şok",
  "eminevim",
  "transfermarkt",
  "sofascore",
  "mackolik",
  "maçkolik",
  "flashscore",
  "facebook",
  "instagram",
  "twitter",
  "tiktok",
  "youtube",
  "google",
  "google translate",
  "çeviri",
  "gmail",
  "outlook",
  "hotmail",
  "whatsapp",
  "whatsapp web",
  "telegram",
  "spotify",
  "chatgpt",
  "e-devlet",
  "e devlet",
  "edevlet",
  "e-okul",
  "e okul",
  "eokul",
  "mebbis",
  "ösym",
  "ais",
  "uyap",
  "mhrs",
  "e-nabız",
  "e nabız",
  "ziraat",
  "ziraat bankası",
  "vakıfbank",
  "vakıf bank",
  "halkbank",
  "iş bankası",
  "garanti",
  "garanti bbva",
  "akbank",
  "yapı kredi",
  "qnb",
  "enpara",
  "papara",
  "nike",
  "adidas",
  "zara",
  "lc waikiki",
  "turkcell",
  "vodafone",
  "türk telekom",
]);

const SITE_PATTERNS = [
  /\.(com|net|org|gov|edu)(\.tr)?$/, // alan adı yazılmış arama
  /\bgiriş$/, // "e-devlet giriş"
];

/** Canlı yayın / izleme aramaları */
// Not: JS'de \b yalnızca ASCII harfleri tanır; Türkçe harfler için (^|\s) … (\s|$) kullanılır
const LIVE_PATTERNS = [/(^|\s)canl[ıi](\s|$)/, /(^|\s)izle$/, /(^|\s)live(\s|$)/];

/** Her gün tekrarlanan hizmet aramaları */
const ROUTINE_PATTERNS = [
  /hava durumu/,
  /^(wetter|weather|hava)$/,
  /\b(imsak|iftar|sahur|ezan|namaz) ?(vakti|vakitleri|saati)?$/,
  /\b(sabah|öğle|ikindi|akşam|yatsı) namazı/,
  /\bfiyat(ı|ları)$/,
  /\bfaiz oranları$/,
  /\b(dolar|euro|sterlin|döviz) kuru$/,
  /hangi diziler var/,
  /yayın akışı/,
  /nöbetçi eczane/,
  /(sayısal loto|süper loto|şans topu|on numara|milli piyango).*(sonuç|çekiliş)/,
  /(^|\s)(çöktü mü|açılmıyor)$/,
];

/** Yasa dışı bahis ve korsan yayın */
const ILLEGAL_PATTERNS = [
  /\bbet(play|boo|ist|win|s|\d+)/,
  /\bbahis\b/,
  /\bcasino\b/,
  /\biptv\b/,
  /taraftarium/,
  /selçuk ?sports?/,
  /justin ?tv/,
  /bedava maç/,
  /\bmaç izle/,
];

/** Latin dışı alfabeler (Arapça, Farsça, Kiril, Yunan, İbrani, Asya) */
const NON_LATIN = /[Ͱ-ϿЀ-ӿ֐-׿؀-ۿݐ-ݿ぀-ヿ一-鿿가-힯]/;

/** Türkçe aramanın İngilizce/Almanca tekrarı ("portugal vs norway", "türkei – italien") */
const FOREIGN_PATTERNS = [
  /(^|\s)vs\.?(\s|$)/,
  /\b(türkei|deutschland|italien|spanien|frankreich|türkiye vs)\b/,
];
const FOREIGN_WORDS = new Set([
  "jobs",
  "flights",
  "events",
  "restaurants",
  "movies",
  "time",
  "swimming",
  "news",
  "hotels",
  "weather",
  "translate",
  "fitness",
]);

const MONTHS = "ocak|şubat|mart|nisan|mayıs|haziran|temmuz|ağustos|eylül|ekim|kasım|aralık";
const DATE_PATTERNS = [
  /^\d{1,4}$/,
  new RegExp(`^\\d{1,2} (${MONTHS})( \\d{4})?$`),
  new RegExp(`^(${MONTHS})( \\d{4})?$`),
  /^(pazartesi|salı|çarşamba|perşembe|cuma|cumartesi|pazar)$/,
];

/** Bir trend aramasının gündem listesine nasıl gireceği */
export function classifyTerm(term: string): TermVerdict {
  const t = normalize(term);
  if (!t) return { verdict: "exclude", reason: "date_or_weekday" };
  if (ILLEGAL_PATTERNS.some((p) => p.test(t))) return { verdict: "exclude", reason: "illegal" };
  if (NON_LATIN.test(t) || FOREIGN_WORDS.has(t) || FOREIGN_PATTERNS.some((p) => p.test(t)))
    return { verdict: "exclude", reason: "foreign_language" };
  if (LIVE_PATTERNS.some((p) => p.test(t))) return { verdict: "exclude", reason: "live_stream" };
  if (ROUTINE_PATTERNS.some((p) => p.test(t)))
    return { verdict: "exclude", reason: "routine_service" };
  if (isMediaTerm(t) || SITES_AND_BRANDS.has(t) || SITE_PATTERNS.some((p) => p.test(t)))
    return { verdict: "exclude", reason: "site_or_brand" };
  if (DATE_PATTERNS.some((p) => p.test(t)))
    return { verdict: "exclude", reason: "date_or_weekday" };
  // Tek kelime ("zeytin", "kredi", "istanbul", "osimhen"): ancak bir haber açıklıyorsa
  if (!t.includes(" ")) return { verdict: "needs_news", reason: "single_word" };
  return { verdict: "keep", reason: null };
}
