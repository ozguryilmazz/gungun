# gundemci.org

Türkiye'de internette **ne konuşuluyor, neden gündemde ve ne kadar hızlı yükseliyor** sorusuna yanıt veren gündem analiz platformu.

> Durum: **Aşama 8 — gerçek gündem.** Haberler toplanıyor, konulara gruplanıyor, skorlanıyor ve
> sitede gösteriliyor. Örnek konuları kaldırmak için `.env` içinde `USE_MOCK_DATA=false` yapıp `pnpm db:seed` çalıştırın.
> Mimari ve MVP planı: [`docs/01-mimari-plan.md`](docs/01-mimari-plan.md) ·
> Arama öncelikli yapı (v0.2, onay bekliyor): [`docs/02-arama-oncelikli-plan.md`](docs/02-arama-oncelikli-plan.md)

## Gereksinimler

- Node.js 24 LTS (en az 22.13)
- pnpm — Corepack ile: `corepack enable` (sürüm `package.json` içinde sabit)
- Docker Desktop (yalnızca PostgreSQL için)
- Git

## Lokal kurulum (Windows / PowerShell)

```powershell
git clone https://github.com/ozguryilmazz/gungun.git
cd gungun
corepack enable
pnpm install

# Ortam değişkenleri — .env Git'e GÖNDERİLMEZ
copy .env.example .env
# .env içinde POSTGRES_PASSWORD ve DATABASE_URL şifresini değiştir

# PostgreSQL'i başlat (yalnızca 127.0.0.1:5432 üzerinden erişilebilir)
pnpm db:up

# Tabloları oluştur ve başlangıç verisini yükle
pnpm db:migrate
pnpm db:seed

# Arayüz + API'yi birlikte başlat (Docker'daki Postgres açık olmalı)
#   arayüz → http://localhost:3000
#   API    → http://127.0.0.1:4000/api/v1/topics
pnpm dev
```

> ⚠ `USE_MOCK_DATA=true` iken `db:seed` **örnek** konular yükler. Bunlar gerçek değildir:
> başlıkları "Örnek:" ile başlar, veritabanında `is_mock=true` işaretlidir ve kaynak
> bağlantıları `example.org`'a gider. `USE_MOCK_DATA=false` yapıp `db:seed` çalıştırmak
> örnek verileri siler.

## Komutlar

| Komut               | Açıklama                        |
| ------------------- | ------------------------------- |
| `pnpm lint`         | ESLint                          |
| `pnpm format`       | Prettier ile biçimlendir        |
| `pnpm format:check` | Biçim kontrolü                  |
| `pnpm db:up`        | PostgreSQL container'ını başlat |
| `pnpm db:down`      | PostgreSQL container'ını durdur |
| `pnpm db:logs`      | PostgreSQL loglarını izle       |

## Veri toplama

- **Sağlayıcılar:** `rss_news` (12 haber sitesinin RSS'i), `google_trends` (Türkiye trend RSS'i) ve
  `google_news_search` (Google Haberler arama RSS'i: trend aramaları açıklayan haberler; robots.txt
  her çalışmada denetlenir) ve `youtube_trending` (resmi YouTube Data API v3, Türkiye trend videoları; `.env`'de `YOUTUBE_API_KEY` gerekir).
  Hepsi **kapalı** başlar.
- **Ne alınır:** Yalnızca başlık, bağlantı ve yayın zamanı. Haber metni alınmaz.
- **Güvenlik:** Dış istekler yalnızca kayıtlı adreslere gider. İç ağ adresleri, aşırı büyük yanıtlar ve
  izin dışı yönlendirmeler engellenir.
- **Dayanıklılık:** Bir kaynak hata verirse diğerleri etkilenmez. Hata tekrarlanırsa o kaynağın deneme
  aralığı otomatik uzar.

İlk deneme için:

```powershell
pnpm fetch:once all   # her kaynağın sonucunu tek tek gösterir
pnpm trends:filter    # son trend listesinde hangi arama neden elendi
pnpm providers enable rss_news
pnpm providers enable google_trends
pnpm providers enable google_news_search
pnpm providers enable youtube_trending
pnpm worker           # açık sağlayıcıları 10–15 dakikada bir çalıştırır (Ctrl+C ile durur)
```

## Gündem nasıl oluşur?

Yapay zekâ kullanılmaz; her adım kurala dayalıdır ve açıklanabilir.

1. **Gruplama:** Son 24 saatin başlıkları Türkçe ekleri soyularak karşılaştırılır. Ortak, ayırt edici
   kelimeleri olan başlıklar aynı konuya girer.
2. **Konu ve yayın eşiği:** En az **2** farklı yayıncıda geçen olay konu olur. **3** yayıncıda geçerse
   (ya da 2 yayıncıda geçip Google Trends'le eşleşirse) sitede yayına girer.
3. **Başlık:** Kaynak başlıklarından seçilir; "SON DAKİKA:" gibi önekler ve bağıran biçim temizlenir.
4. **Kategori:** Haber adreslerindeki bölüm adından çıkarılır (ör. `/ekonomi/`).
5. **Özet:** Konular için özet **üretilmez**. "Neden gündemde?" bölümünde yalnızca ölçülen bilgiler yer
   alır (kaç kaynakta geçtiği, son saatteki haber sayısı, eşleşen arama trendi).
6. **Yaşam döngüsü:** 6 saat yeni haber gelmezse konu "soğuyan", 24 saat gelmezse "arşiv" olur.
   Arşiv sayfaları: `/arsiv`.

## API (v1)

| Uç nokta                              | Açıklama                                      |
| ------------------------------------- | --------------------------------------------- |
| `GET /api/v1/topics?category=&limit=` | Güncel gündem (skora göre sıralı)             |
| `GET /api/v1/topics/rising`           | Şu anda yükselenler (en az 3 kaynaklı)        |
| `GET /api/v1/topics/falling`          | Gündemden düşenler                            |
| `GET /api/v1/topics/:slug`            | Konu detayı: skor bileşenleri, kaynaklar…     |
| `GET /api/v1/topics/:slug/history`    | Son 24 saatin skor geçmişi                    |
| `GET /api/v1/categories`              | Kategoriler                                   |
| `GET /api/v1/meta/status`             | Veri kaynaklarının durumu                     |
| `GET /api/v1/youtube?limit=10`        | YouTube Türkiye trend videoları (en fazla 50) |
| `GET /health`, `GET /health/ready`    | Sağlık kontrolleri                            |

Yanıt biçimleri `packages/shared/src/contract.ts` içindeki şemalarla tanımlıdır. Hatalar her zaman
`{ "error": { "code", "message" } }` biçimindedir; teknik ayrıntı yalnızca sunucu logundadır.

## Klasör yapısı

```
apps/web    Next.js arayüzü (veriyi yalnızca API'den alır)
apps/api    Fastify public API (PostgreSQL'den okur)
packages/   config (ortak TS ayarları), db (şema, migration, seed),
            shared (API sözleşmesi, skor hesabı, kategoriler, örnek konular)
infra/      lokal docker-compose
docs/       mimari ve kararlar
```

## Güvenlik

- Gerçek anahtar/şifreler yalnızca `.env` dosyasında tutulur; `.env` `.gitignore` ile hariç tutulur.
- Güvenlik açığı bildirimi için repo sahibiyle doğrudan iletişime geçin.
