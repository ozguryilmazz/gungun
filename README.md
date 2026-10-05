# gundemci.org

Türkiye'de internette **ne konuşuluyor, neden gündemde ve ne kadar hızlı yükseliyor** sorusuna yanıt veren gündem analiz platformu.

> Durum: **Aşama 5 — backend API.** Arayüz (aşama 4) ve veritabanından okuyan public API hazır.
> Arayüz henüz API'ye bağlı değil, kendi örnek veri kaynağını kullanıyor (aşama 6'da bağlanacak).
> Mimari ve MVP planı: [`docs/01-mimari-plan.md`](docs/01-mimari-plan.md)

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

# Arayüz + API'yi birlikte başlat
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

## API (v1)

| Uç nokta                              | Açıklama                                  |
| ------------------------------------- | ----------------------------------------- |
| `GET /api/v1/topics?category=&limit=` | Güncel gündem (skora göre sıralı)         |
| `GET /api/v1/topics/rising`           | Şu anda yükselenler (en az 3 kaynaklı)    |
| `GET /api/v1/topics/falling`          | Gündemden düşenler                        |
| `GET /api/v1/topics/:slug`            | Konu detayı: skor bileşenleri, kaynaklar… |
| `GET /api/v1/topics/:slug/history`    | Son 24 saatin skor geçmişi                |
| `GET /api/v1/categories`              | Kategoriler                               |
| `GET /api/v1/meta/status`             | Veri kaynaklarının durumu                 |
| `GET /health`, `GET /health/ready`    | Sağlık kontrolleri                        |

Yanıt biçimleri `packages/shared/src/contract.ts` içindeki şemalarla tanımlıdır. Hatalar her zaman
`{ "error": { "code", "message" } }` biçimindedir; teknik ayrıntı yalnızca sunucu logundadır.

## Klasör yapısı

```
apps/web    Next.js arayüzü (şimdilik örnek veri kaynağıyla)
apps/api    Fastify public API (PostgreSQL'den okur)
packages/   config (ortak TS ayarları), db (şema, migration, seed),
            shared (API sözleşmesi, skor hesabı, kategoriler, örnek konular)
infra/      lokal docker-compose
docs/       mimari ve kararlar
```

## Güvenlik

- Gerçek anahtar/şifreler yalnızca `.env` dosyasında tutulur; `.env` `.gitignore` ile hariç tutulur.
- Güvenlik açığı bildirimi için repo sahibiyle doğrudan iletişime geçin.
