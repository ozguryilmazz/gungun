// Türkçe başlık işleme: kelimelere ayırma, durak kelimeleri atma ve basit kök bulma.
// Yapay zekâ kullanılmaz; sonuç her zaman aynı girdiye aynı çıktıyı verir (açıklanabilir).

/** Anlam taşımayan veya her haberde geçen kelimeler (kök hâlleriyle de eşleşir) */
const STOPWORDS = new Set(
  [
    "ve",
    "ile",
    "bir",
    "bu",
    "şu",
    "o",
    "da",
    "de",
    "ki",
    "mi",
    "mı",
    "mu",
    "mü",
    "için",
    "gibi",
    "daha",
    "çok",
    "en",
    "ne",
    "ya",
    "ama",
    "veya",
    "ya da",
    "olan",
    "oldu",
    "olarak",
    "olduğu",
    "sonra",
    "önce",
    "kadar",
    "her",
    "son",
    "dakika",
    "sondakika",
    "yeni",
    "işte",
    "neler",
    "nedir",
    "nasıl",
    "kim",
    "kimdir",
    "zaman",
    "saat",
    "bugün",
    "dün",
    "yarın",
    "haber",
    "haberi",
    "haberleri",
    "video",
    "foto",
    "galeri",
    "canlı",
    "flaş",
    "açıklama",
    "açıklaması",
    "açıkladı",
    "dedi",
    "dikkat",
    "çeken",
    "ilk",
    "büyük",
    "tüm",
    "bütün",
    "yüzde",
    "milyon",
    "milyar",
    "bin",
    "yıl",
    "gün",
    "ay",
    "hafta",
    "sayı",
    "var",
    "yok",
    "değil",
    "ise",
    "hem",
    "çünkü",
    "üzerine",
    "karşı",
    "göre",
    "artık",
    "geldi",
    "gelen",
    "verdi",
    "etti",
    "eden",
    "yaptı",
    "yapılan",
    "aldı",
    "alan",
    "olay",
    "oldu",
    "şok",
    "bomba",
    "flash",
    "son dakika",
    "güncel",
    "ilgili",
    "hakkında",
    "tarafından",
    "sırasında",
  ].map((w) => w.toLocaleLowerCase("tr-TR")),
);

/**
 * Yaygın Türkçe çekim ekleri (uzundan kısaya). Basit, kurallı bir ek soyucu:
 * "faizini" → "faiz", "kararına" → "karar", "derbide" ve "derbisi" → "derb".
 * Tam bir morfolojik çözümleyici değildir; amaç aynı olayı anlatan başlıkları eşleştirmektir.
 */
const SUFFIXES = [
  // iyelik + hal eki birleşimleri: kazasında, başkanının, tepkisiyle
  "sından",
  "sinden",
  "sundan",
  "sünden",
  "sında",
  "sinde",
  "sunda",
  "sünde",
  "sının",
  "sinin",
  "sunun",
  "sünün",
  "sıyla",
  "siyle",
  "suyla",
  "süyle",
  "sına",
  "sine",
  "suna",
  "süne",
  "sını",
  "sini",
  "sunu",
  "sünü",
  "ıyla",
  "iyle",
  "uyla",
  "üyle",
  "lerinden",
  "larından",
  "lerinde",
  "larında",
  "lerine",
  "larına",
  "lerini",
  "larını",
  "ndaki",
  "ndeki",
  "inden",
  "ından",
  "undan",
  "ünden",
  "ının",
  "inin",
  "unun",
  "ünün",
  "leri",
  "ları",
  "daki",
  "deki",
  "taki",
  "teki",
  "nden",
  "ndan",
  "inde",
  "ında",
  "unda",
  "ünde",
  "ler",
  "lar",
  "den",
  "dan",
  "ten",
  "tan",
  "nde",
  "nda",
  "nın",
  "nin",
  "nun",
  "nün",
  "ını",
  "ini",
  "unu",
  "ünü",
  "ına",
  "ine",
  "una",
  "üne",
  "yla",
  "yle",
  "de",
  "da",
  "te",
  "ta",
  "ın",
  "in",
  "un",
  "ün",
  "nı",
  "ni",
  "nu",
  "nü",
  "la",
  "le",
  "ya",
  "ye",
  "na",
  "ne",
  "sı",
  "si",
  "su",
  "sü",
  "yı",
  "yi",
  "yu",
  "yü",
  "ı",
  "i",
  "u",
  "ü",
  "a",
  "e",
];
const MIN_STEM = 3;
/** Uzun kelimelerde kökten sonrası (yapım ekleri) karşılaştırmayı bozmasın diye üst sınır */
const MAX_STEM = 6;

export function stem(word: string): string | null {
  let w = word;
  for (let pass = 0; pass < 4; pass++) {
    if (STOPWORDS.has(w)) return null;
    const suffix = SUFFIXES.find((s) => w.endsWith(s) && w.length - s.length >= MIN_STEM);
    if (!suffix) break;
    w = w.slice(0, -suffix.length);
  }
  if (STOPWORDS.has(w)) return null;
  return w.slice(0, MAX_STEM);
}

/** Başlığı anlamlı kelime köklerine çevirir: "İsrail'in yerleşim faaliyetlerine" → [israi, yerle, faali] */
export function tokenize(title: string): string[] {
  const lower = title.toLocaleLowerCase("tr-TR");
  const words = lower
    // Kesme işaretinden sonraki ek atılır: istanbul'da → istanbul
    .replace(/['’‘`´][a-zçğıöşü]+/g, "")
    .split(/[^a-zçğıöşüâîû0-9]+/u)
    .filter(Boolean);
  const out: string[] = [];
  for (const w of words) {
    if (w.length < 3) continue;
    if (/^\d+$/.test(w)) continue; // sayılar konu ayırt etmez
    const s = stem(w);
    if (s) out.push(s);
  }
  return [...new Set(out)];
}

/** Türkçe karakterleri ASCII'ye çevirip URL'de kullanılabilir kısa ad üretir */
export function slugify(text: string, maxLength = 80): string {
  const map: Record<string, string> = {
    ç: "c",
    ğ: "g",
    ı: "i",
    i: "i",
    ö: "o",
    ş: "s",
    ü: "u",
    â: "a",
    î: "i",
    û: "u",
  };
  const ascii = text
    .toLocaleLowerCase("tr-TR")
    .replace(/[çğıiöşüâîû]/g, (c) => map[c] ?? c)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "");
  let slug = ascii.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  if (slug.length > maxLength) {
    slug = slug.slice(0, maxLength);
    // Kelime ortasından kesmemek için son tireye kadar kısalt
    const cut = slug.lastIndexOf("-");
    if (cut > maxLength / 2) slug = slug.slice(0, cut);
  }
  return slug || "konu";
}

// Türkçe küçük harfe çevrilmiş metinde aranır ("İ" harfi standart /i eşleşmesinde sorun çıkarır)
const CLICKBAIT_PREFIX =
  /^\s*(son\s*dakika(\s*haberi)?|sondakika|flaş|flash|canlı|şok|bomba)\s*[:|\-–—!.]*\s*/u;

/**
 * Konu başlığı, kaynak başlıklarından seçilir; bağıran biçim yumuşatılır:
 * "SON DAKİKA: ... !!!" önekleri ve sondaki ünlemler atılır, tamamı büyük harf ise
 * cümle düzenine çevrilir. Anlam değiştirilmez, yeni ifade uydurulmaz.
 */
export function calmTitle(title: string): string {
  let t = title.trim();
  for (let i = 0; i < 3; i++) {
    // tr-TR küçük harf dönüşümü karakter sayısını korur; eşleşme uzunluğu orijinalde de geçerlidir
    const match = CLICKBAIT_PREFIX.exec(t.toLocaleLowerCase("tr-TR"));
    if (!match || match[0].length === 0) break;
    t = t.slice(match[0].length);
  }
  t = t
    .replace(/\s*[!]+\s*$/u, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  const letters = t.replace(/[^a-zA-ZçğıöşüÇĞİÖŞÜ]/g, "");
  const upper = t.replace(/[^A-ZÇĞİÖŞÜ]/g, "");
  if (letters.length >= 8 && upper.length / letters.length > 0.7) {
    const lower = t.toLocaleLowerCase("tr-TR");
    t = lower.charAt(0).toLocaleUpperCase("tr-TR") + lower.slice(1);
  }
  return t.slice(0, 200);
}

/** Başlıktaki kelimeler (ekler soyulmadan; yalnızca kesme işaretinden sonrası atılır) */
export function words(title: string): string[] {
  return title
    .toLocaleLowerCase("tr-TR")
    .replace(/['’‘`´][a-zçğıöşü]+/g, "")
    .split(/[^a-zçğıöşüâîû0-9]+/u)
    .filter(Boolean);
}

/**
 * Gazete, kanal ve ajans adları. Bu terimler Google'da çoğunlukla sitenin kendisine ulaşmak için
 * aranır; bir olayın arama ilgisi sayılmaz ("Sözcü" araması ≠ "AK Parti Sözcüsü" haberi).
 */
const MEDIA_TERMS = new Set(
  [
    "sözcü",
    "sözcü tv",
    "sabah",
    "hürriyet",
    "milliyet",
    "cumhuriyet",
    "habertürk",
    "haberturk",
    "ntv",
    "trt",
    "trt haber",
    "trt 1",
    "trt1",
    "cnn türk",
    "cnn turk",
    "aa",
    "anadolu ajansı",
    "bbc",
    "bbc türkçe",
    "dw",
    "dw türkçe",
    "a haber",
    "ahaber",
    "halk tv",
    "halktv",
    "fox tv",
    "now tv",
    "show tv",
    "kanal d",
    "star tv",
    "atv",
    "tv8",
    "tele1",
    "tv100",
    "ekol tv",
    "sözcü gazetesi",
    "sabah gazetesi",
    "posta",
    "takvim",
    "yeni şafak",
    "karar",
    "t24",
    "diken",
    "odatv",
    "oda tv",
    "medyascope",
    "euronews",
    "bloomberg ht",
    "bloomberght",
    "ensonhaber",
    "haberler",
  ].map((t) => t.toLocaleLowerCase("tr-TR")),
);

export function isMediaTerm(term: string): boolean {
  return MEDIA_TERMS.has(term.toLocaleLowerCase("tr-TR").trim().replace(/\s+/g, " "));
}

/**
 * Kelime, terimin kendisi mi yoksa terim + HAL eki mi? (derbide, depremden, İstanbul'a)
 * İyelik ekleri (sözcüsü, başkanı) kabul EDİLMEZ: anlam değişebilir ("sözcü" ≠ "parti sözcüsü").
 */
const CASE_SUFFIXES = [
  "",
  "de",
  "da",
  "te",
  "ta",
  "den",
  "dan",
  "ten",
  "tan",
  "e",
  "a",
  "ye",
  "ya",
  "i",
  "ı",
  "u",
  "ü",
  "yi",
  "yı",
  "yu",
  "yü",
  "in",
  "ın",
  "un",
  "ün",
  "nin",
  "nın",
  "nun",
  "nün",
  "le",
  "la",
  "yle",
  "yla",
  "ler",
  "lar",
];

export function isTermWithCase(word: string, term: string): boolean {
  if (!word.startsWith(term)) return false;
  return CASE_SUFFIXES.includes(word.slice(term.length));
}

/** İngilizce/Almanca/Fransızca sık bağlaç ve edatlar (Türkçede bu biçimde kullanılmaz) */
const FOREIGN_STOPWORDS = new Set([
  "the",
  "and",
  "of",
  "to",
  "from",
  "in",
  "on",
  "for",
  "with",
  "is",
  "are",
  "was",
  "were",
  "their",
  "his",
  "her",
  "its",
  "after",
  "how",
  "what",
  "why",
  "who",
  "at",
  "by",
  "as",
  "this",
  "that",
  "will",
  "has",
  "have",
  "be",
  "an",
  "into",
  "over",
  "about",
  "most",
  "all",
  "der",
  "die",
  "das",
  "und",
  "mit",
  "für",
  "ist",
  "von",
  "den",
  "im",
  "le",
  "la",
  "les",
  "des",
  "et",
  "pour",
  "avec",
  "est",
]);

/**
 * Başlık Türkçe mi? (Kural tabanlı, yapay zekâ yok.) Türkçe harf (ç ğ ı ö ş ü İ) varsa Türkçe sayılır;
 * yoksa en az 2 yabancı bağlaç/edat içeren başlık yabancı dilde sayılır.
 */
export function looksTurkish(title: string): boolean {
  if (/[çğıöşüÇĞİÖŞÜ]/.test(title)) return true;
  const ws = title
    .toLowerCase()
    .split(/[^a-zäß0-9]+/)
    .filter(Boolean);
  return ws.filter((w) => FOREIGN_STOPWORDS.has(w)).length < 2;
}
