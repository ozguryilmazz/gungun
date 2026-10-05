export interface CategoryDef {
  slug: string;
  name: string;
  sortOrder: number;
}

/** Sabit kategori listesi — veritabanı seed'i ve arayüz aynı listeyi kullanır. */
export const CATEGORIES: readonly CategoryDef[] = [
  { slug: "turkiye", name: "Türkiye", sortOrder: 1 },
  { slug: "dunya", name: "Dünya", sortOrder: 2 },
  { slug: "siyaset", name: "Siyaset", sortOrder: 3 },
  { slug: "ekonomi", name: "Ekonomi", sortOrder: 4 },
  { slug: "spor", name: "Spor", sortOrder: 5 },
  { slug: "magazin", name: "Magazin", sortOrder: 6 },
  { slug: "teknoloji", name: "Teknoloji", sortOrder: 7 },
  { slug: "bilim", name: "Bilim", sortOrder: 8 },
  { slug: "kultur", name: "Kültür", sortOrder: 9 },
  { slug: "yasam", name: "Yaşam", sortOrder: 10 },
  { slug: "viral", name: "Viral", sortOrder: 11 },
  { slug: "diger", name: "Diğer", sortOrder: 12 },
];

export function findCategory(slug: string): CategoryDef | undefined {
  return CATEGORIES.find((c) => c.slug === slug);
}
