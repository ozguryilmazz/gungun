// ⚠ ÖRNEK (MOCK) VERİ — GERÇEK DEĞİLDİR.
// Arayüz geliştirmek için uydurulmuş, gerçek bir olayı anlatmayan konular.
// Başlıklar "Örnek:" ile başlar; veritabanına her zaman is_mock=true olarak yazılır.
// Hem veritabanı seed'i (packages/db) hem de API bağlanana kadar web arayüzü bunu kullanır.

import type { ComponentInput } from "./scoring.ts";

export interface MockSnapshotInput {
  /** Seed anından kaç dakika önce */
  minutesAgo: number;
  normalized: ComponentInput;
}

export interface MockTopic {
  slug: string;
  title: string;
  categorySlug: string;
  status: "published" | "cooling";
  summary: string;
  reasons: string[];
  firstSeenMinutesAgo: number;
  /** Sırayla: eski → yeni */
  snapshots: [MockSnapshotInput, MockSnapshotInput];
  sourceCount: number;
  withTimeline: boolean;
}

const NO_SOCIAL = null;

export const MOCK_TOPICS: readonly MockTopic[] = [
  {
    slug: "ornek-yeni-nesil-akilli-telefon-tanitimi",
    title: "Örnek: Yeni nesil akıllı telefon tanıtımı",
    categorySlug: "teknoloji",
    status: "published",
    summary:
      "Bu bir örnek konudur. Bir teknoloji şirketinin yeni telefonunu tanıttığı varsayılan senaryoda, tanıtım sonrası haber kaynaklarında ve aramalarda artış gösterilmektedir.",
    reasons: [
      "Örnek: Tanıtım etkinliği düzenlendi",
      "Örnek: Fiyat bilgisi paylaşıldı",
      "Örnek: Karşılaştırma haberleri yayımlandı",
    ],
    firstSeenMinutesAgo: 300,
    snapshots: [
      {
        minutesAgo: 180,
        normalized: {
          news_visibility: 0.55,
          velocity: 0.5,
          search_interest: 0.6,
          social: NO_SOCIAL,
        },
      },
      {
        minutesAgo: 4,
        normalized: {
          news_visibility: 0.9,
          velocity: 0.95,
          search_interest: 0.92,
          social: NO_SOCIAL,
        },
      },
    ],
    sourceCount: 4,
    withTimeline: true,
  },
  {
    slug: "ornek-super-lig-derbi-haftasi",
    title: "Örnek: Süper Lig'de derbi haftası",
    categorySlug: "spor",
    status: "published",
    summary:
      "Bu bir örnek konudur. Hafta sonu oynanacağı varsayılan bir derbi öncesi kadro ve hakem haberlerinin gündemde olduğu bir senaryo gösterilmektedir.",
    reasons: ["Örnek: Hakem ataması açıklandı", "Örnek: Sakatlık haberleri paylaşıldı"],
    firstSeenMinutesAgo: 720,
    snapshots: [
      {
        minutesAgo: 180,
        normalized: {
          news_visibility: 0.7,
          velocity: 0.55,
          search_interest: 0.75,
          social: NO_SOCIAL,
        },
      },
      {
        minutesAgo: 6,
        normalized: {
          news_visibility: 0.85,
          velocity: 0.7,
          search_interest: 0.88,
          social: NO_SOCIAL,
        },
      },
    ],
    sourceCount: 3,
    withTimeline: false,
  },
  {
    slug: "ornek-faiz-karari-beklentisi",
    title: "Örnek: Faiz kararı beklentisi",
    categorySlug: "ekonomi",
    status: "published",
    summary:
      "Bu bir örnek konudur. Yaklaşan bir para politikası toplantısı öncesinde beklenti anketlerinin konuşulduğu varsayımsal bir senaryodur.",
    reasons: ["Örnek: Beklenti anketi yayımlandı", "Örnek: Piyasa yorumları arttı"],
    firstSeenMinutesAgo: 1440,
    snapshots: [
      {
        minutesAgo: 180,
        normalized: {
          news_visibility: 0.6,
          velocity: 0.35,
          search_interest: 0.5,
          social: NO_SOCIAL,
        },
      },
      {
        minutesAgo: 8,
        normalized: {
          news_visibility: 0.75,
          velocity: 0.6,
          search_interest: 0.7,
          social: NO_SOCIAL,
        },
      },
    ],
    sourceCount: 3,
    withTimeline: false,
  },
  {
    slug: "ornek-uzay-gorevi-firlatmasi",
    title: "Örnek: Uzay görevi fırlatması",
    categorySlug: "bilim",
    status: "published",
    // Arama verisi olmayan konu: arayüzde "Veri bekleniyor" durumunu göstermek için
    summary:
      "Bu bir örnek konudur. Bir uzay görevinin fırlatıldığı varsayılan senaryoda arama verisi bulunmadığı için skor yalnızca haber sinyallerinden hesaplanmıştır.",
    reasons: ["Örnek: Fırlatma canlı yayınlandı", "Örnek: Görev ekibi açıklama yaptı"],
    firstSeenMinutesAgo: 240,
    snapshots: [
      {
        minutesAgo: 180,
        normalized: {
          news_visibility: 0.3,
          velocity: 0.35,
          search_interest: null,
          social: NO_SOCIAL,
        },
      },
      {
        minutesAgo: 10,
        normalized: {
          news_visibility: 0.6,
          velocity: 0.85,
          search_interest: null,
          social: NO_SOCIAL,
        },
      },
    ],
    sourceCount: 2,
    withTimeline: false,
  },
  {
    slug: "ornek-dizi-final-bolumu",
    title: "Örnek: Bir dizinin final bölümü",
    categorySlug: "kultur",
    status: "published",
    summary:
      "Bu bir örnek konudur. Bir dizinin final bölümü sonrasında izleyici yorumlarının ve aramaların arttığı varsayımsal bir senaryodur.",
    reasons: ["Örnek: Final bölümü yayımlandı", "Örnek: Oyuncular açıklama yaptı"],
    firstSeenMinutesAgo: 600,
    snapshots: [
      {
        minutesAgo: 180,
        normalized: {
          news_visibility: 0.45,
          velocity: 0.4,
          search_interest: 0.65,
          social: NO_SOCIAL,
        },
      },
      {
        minutesAgo: 12,
        normalized: {
          news_visibility: 0.55,
          velocity: 0.45,
          search_interest: 0.7,
          social: NO_SOCIAL,
        },
      },
    ],
    sourceCount: 2,
    withTimeline: false,
  },
  {
    slug: "ornek-kis-lastigi-uygulamasi",
    title: "Örnek: Kış lastiği uygulaması",
    categorySlug: "yasam",
    status: "published",
    summary:
      "Bu bir örnek konudur. Mevsimsel bir trafik uygulamasının başlangıç tarihinin arandığı varsayımsal bir senaryodur.",
    reasons: ["Örnek: Uygulama tarihi hatırlatıldı"],
    firstSeenMinutesAgo: 2000,
    snapshots: [
      {
        minutesAgo: 180,
        normalized: {
          news_visibility: 0.4,
          velocity: 0.3,
          search_interest: 0.55,
          social: NO_SOCIAL,
        },
      },
      {
        minutesAgo: 15,
        normalized: {
          news_visibility: 0.4,
          velocity: 0.3,
          search_interest: 0.5,
          social: NO_SOCIAL,
        },
      },
    ],
    sourceCount: 2,
    withTimeline: false,
  },
  {
    slug: "ornek-viral-sokak-roportaji",
    title: "Örnek: Viral olan sokak röportajı",
    categorySlug: "viral",
    status: "cooling",
    // Düşen konu örneği
    summary:
      "Bu bir örnek konudur. Dün çok paylaşılan bir sokak röportajının ilgisinin azaldığı varsayımsal bir senaryodur.",
    reasons: ["Örnek: Video çok paylaşıldı", "Örnek: İlgi azalmaya başladı"],
    firstSeenMinutesAgo: 1600,
    snapshots: [
      {
        minutesAgo: 180,
        normalized: {
          news_visibility: 0.65,
          velocity: 0.6,
          search_interest: 0.8,
          social: NO_SOCIAL,
        },
      },
      {
        minutesAgo: 9,
        normalized: {
          news_visibility: 0.4,
          velocity: 0.1,
          search_interest: 0.45,
          social: NO_SOCIAL,
        },
      },
    ],
    sourceCount: 2,
    withTimeline: false,
  },
  {
    slug: "ornek-uluslararasi-iklim-zirvesi",
    title: "Örnek: Uluslararası iklim zirvesi",
    categorySlug: "dunya",
    status: "published",
    summary:
      "Bu bir örnek konudur. Çok sayıda ülkenin katıldığı varsayılan bir iklim zirvesindeki görüşmelerin takip edildiği bir senaryodur.",
    reasons: ["Örnek: Zirve başladı", "Örnek: Ortak bildiri taslağı konuşuldu"],
    firstSeenMinutesAgo: 900,
    snapshots: [
      {
        minutesAgo: 180,
        normalized: {
          news_visibility: 0.6,
          velocity: 0.4,
          search_interest: 0.35,
          social: NO_SOCIAL,
        },
      },
      {
        minutesAgo: 20,
        normalized: {
          news_visibility: 0.55,
          velocity: 0.35,
          search_interest: 0.3,
          social: NO_SOCIAL,
        },
      },
    ],
    sourceCount: 3,
    withTimeline: false,
  },
];
