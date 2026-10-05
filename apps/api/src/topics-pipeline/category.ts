// Kategori, kaynak haber adreslerindeki bölüm adından çıkarılır (ör. /ekonomi/...).
// Kaynakların çoğunluğu hangi bölümdeyse konu o kategoriye girer; belirsizse "diger".

const SECTION_TO_CATEGORY: Record<string, string> = {
  gundem: "turkiye",
  turkiye: "turkiye",
  "yurt-ici": "turkiye",
  yurtici: "turkiye",
  "yerel-haberler": "turkiye",
  dunya: "dunya",
  "dunya-haberleri": "dunya",
  "yurt-disi": "dunya",
  politika: "siyaset",
  siyaset: "siyaset",
  ekonomi: "ekonomi",
  finans: "ekonomi",
  para: "ekonomi",
  "ekonomi-haberleri": "ekonomi",
  spor: "spor",
  futbol: "spor",
  basketbol: "spor",
  voleybol: "spor",
  magazin: "magazin",
  kelebek: "magazin",
  "magazin-haberleri": "magazin",
  teknoloji: "teknoloji",
  "bilim-teknoloji": "teknoloji",
  "bilim-ve-teknoloji": "teknoloji",
  bilim: "bilim",
  kultur: "kultur",
  "kultur-sanat": "kultur",
  sanat: "kultur",
  sinema: "kultur",
  yasam: "yasam",
  saglik: "yasam",
  egitim: "yasam",
  hayat: "yasam",
  otomobil: "yasam",
  seyahat: "yasam",
};

/** Adresin ilk anlamlı bölüm adı → kategori (bilinmiyorsa null) */
export function categoryFromUrl(url: string): string | null {
  let path: string;
  try {
    path = new URL(url).pathname.toLowerCase();
  } catch {
    return null;
  }
  for (const segment of path.split("/").filter(Boolean).slice(0, 3)) {
    const hit = SECTION_TO_CATEGORY[segment];
    if (hit) return hit;
  }
  return null;
}

export function inferCategory(urls: string[]): string {
  const votes = new Map<string, number>();
  for (const url of urls) {
    const c = categoryFromUrl(url);
    if (c) votes.set(c, (votes.get(c) ?? 0) + 1);
  }
  let best = "diger";
  let bestVotes = 0;
  for (const [c, n] of votes) {
    if (n > bestVotes) {
      best = c;
      bestVotes = n;
    }
  }
  return best;
}
