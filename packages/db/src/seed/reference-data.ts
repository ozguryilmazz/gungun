// Gerçek referans verisi: kategoriler, veri sağlayıcıları ve yayıncılar.
// Bu dosyada ÖRNEK (mock) veri yoktur.

export { CATEGORIES } from "@gundemci/shared";

export interface ProviderSeed {
  key: string;
  kind: "trend" | "news" | "social" | "manual";
  name: string;
  config: Record<string, unknown>;
}

const BOT_USER_AGENT = "gundemciBot/0.1 (+https://gundemci.org/bot)";

// Tümü KAPALI başlar; ağdan veri çekme aşama 7'de, adresler doğrulandıktan sonra açılır.
export const DATA_PROVIDERS: readonly ProviderSeed[] = [
  {
    key: "google_trends",
    kind: "trend",
    name: "Google Trends (TR trend RSS)",
    config: {
      feedUrl: "https://trends.google.com/trending/rss?geo=TR",
      geo: "TR",
      minIntervalMinutes: 15,
      userAgent: BOT_USER_AGENT,
    },
  },
  {
    key: "rss_news",
    kind: "news",
    name: "Haber RSS akışları",
    config: {
      minIntervalMinutes: 10,
      userAgent: BOT_USER_AGENT,
    },
  },
  {
    // Resmi YouTube Data API v3; anahtar .env'deki YOUTUBE_API_KEY (yalnızca sunucuda)
    key: "youtube_trending",
    kind: "social",
    name: "YouTube Türkiye trendleri",
    config: {
      regionCode: "TR",
      maxResults: 50,
      minIntervalMinutes: 20,
    },
  },
];

/**
 * Kullanımdan kaldırılan sağlayıcılar: seed sırasında silinir (kaydı yoksa).
 * google_news_search: news.google.com robots.txt'i /rss/search'e bot erişimine izin vermiyor.
 * gdelt_news: istek sınırı çok dar (sık 429); kaldırıldı. Kayıtları 0005 migration'ında silindi.
 */
export const RETIRED_PROVIDER_KEYS: readonly string[] = ["google_news_search", "gdelt_news"];

export interface PublisherSeed {
  name: string;
  /** Kayıtlı alan adı (homepage host'u bu alan adı veya alt alan adı olmalı) */
  domain: string;
  homepageUrl: string;
  /** Aday RSS adresi — aşama 7'de lokal makinede doğrulanacak */
  feedUrl: string;
}

// Seçim ölçütü: erişim büyüklüğü + farklı yayın çizgilerinden dengeli dağılım
// + uluslararası yayıncıların Türkçe servisleri. Ayrıntı: docs/01-mimari-plan.md
export const PUBLISHERS: readonly PublisherSeed[] = [
  {
    name: "Anadolu Ajansı",
    domain: "aa.com.tr",
    homepageUrl: "https://www.aa.com.tr/tr",
    feedUrl: "https://www.aa.com.tr/tr/rss/default?cat=guncel",
  },
  {
    name: "TRT Haber",
    domain: "trthaber.com",
    homepageUrl: "https://www.trthaber.com",
    feedUrl: "https://www.trthaber.com/sondakika.rss",
  },
  {
    name: "NTV",
    domain: "ntv.com.tr",
    homepageUrl: "https://www.ntv.com.tr",
    feedUrl: "https://www.ntv.com.tr/gundem.rss",
  },
  {
    name: "CNN Türk",
    domain: "cnnturk.com",
    homepageUrl: "https://www.cnnturk.com",
    feedUrl: "https://www.cnnturk.com/feed/rss/all/news",
  },
  {
    name: "Habertürk",
    domain: "haberturk.com",
    homepageUrl: "https://www.haberturk.com",
    feedUrl: "https://www.haberturk.com/rss",
  },
  {
    name: "Hürriyet",
    domain: "hurriyet.com.tr",
    homepageUrl: "https://www.hurriyet.com.tr",
    feedUrl: "https://www.hurriyet.com.tr/rss/anasayfa",
  },
  {
    name: "Milliyet",
    domain: "milliyet.com.tr",
    homepageUrl: "https://www.milliyet.com.tr",
    feedUrl: "https://www.milliyet.com.tr/rss/rssnew/gundemrss.xml",
  },
  {
    name: "Sabah",
    domain: "sabah.com.tr",
    homepageUrl: "https://www.sabah.com.tr",
    feedUrl: "https://www.sabah.com.tr/rss/gundem.xml",
  },
  {
    name: "Sözcü",
    domain: "sozcu.com.tr",
    homepageUrl: "https://www.sozcu.com.tr",
    feedUrl: "https://www.sozcu.com.tr/feeds-rss-category-sozcu",
  },
  {
    name: "Cumhuriyet",
    domain: "cumhuriyet.com.tr",
    homepageUrl: "https://www.cumhuriyet.com.tr",
    feedUrl: "https://www.cumhuriyet.com.tr/rss/son_dakika.xml",
  },
  {
    name: "BBC News Türkçe",
    domain: "bbc.com",
    homepageUrl: "https://www.bbc.com/turkce",
    feedUrl: "https://feeds.bbci.co.uk/turkce/rss.xml",
  },
  {
    name: "DW Türkçe",
    domain: "dw.com",
    homepageUrl: "https://www.dw.com/tr",
    feedUrl: "https://rss.dw.com/rdf/rss-tur-all",
  },
  // Kullanıcının eklediği kaynaklar (adresler feed:inspect ile doğrulanmalı)
  {
    name: "BirGün",
    domain: "birgun.net",
    homepageUrl: "https://www.birgun.net",
    feedUrl: "https://www.birgun.net/xml/rss.xml",
  },
  {
    name: "Sporx",
    domain: "sporx.com",
    homepageUrl: "https://www.sporx.com",
    feedUrl: "https://www.sporx.com/rss/",
  },
  {
    name: "NTV Spor",
    domain: "ntvspor.net",
    homepageUrl: "https://www.ntvspor.net",
    feedUrl: "https://www.ntvspor.net/rss/gundem",
  },
  {
    name: "Bloomberg HT",
    domain: "bloomberght.com",
    homepageUrl: "https://www.bloomberght.com",
    feedUrl: "https://www.bloomberght.com/rss",
  },
  {
    name: "T24",
    domain: "t24.com.tr",
    homepageUrl: "https://t24.com.tr",
    feedUrl: "https://t24.com.tr/rss",
  },
  {
    name: "Gazete Duvar",
    domain: "gazeteduvar.com.tr",
    homepageUrl: "https://www.gazeteduvar.com.tr",
    feedUrl: "https://www.gazeteduvar.com.tr/rss",
  },
  {
    name: "Euronews Türkçe",
    domain: "euronews.com",
    homepageUrl: "https://tr.euronews.com",
    feedUrl: "https://tr.euronews.com/rss",
  },
];
