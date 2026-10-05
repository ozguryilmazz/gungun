// ⚠ ÖRNEK (MOCK) VERİ — GERÇEK DEĞİLDİR.
// Örnek konuların kendisi packages/shared/src/mock-topics.ts içindedir. Bu dosya yalnızca
// örnek kaynakların veritabanındaki yayıncı/sağlayıcı kayıtlarını tanımlar.
// Kaynak bağlantıları ayrılmış test alan adı example.org'a gider.

export const MOCK_PUBLISHER = {
  name: "Örnek Kaynak (mock)",
  domain: "example.org",
  homepageUrl: "https://example.org",
} as const;

export const MOCK_PROVIDER = {
  key: "seed",
  kind: "manual",
  name: "Örnek veri (seed)",
} as const;
