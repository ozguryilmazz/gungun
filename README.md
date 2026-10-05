# gundemci.org

Türkiye'de internette **ne konuşuluyor, neden gündemde ve ne kadar hızlı yükseliyor** sorusuna yanıt veren gündem analiz platformu.

> Durum: **Aşama 4 — ilk çalışan arayüz.** Ana sayfa, kategori, konu detayı ve skor açıklaması
> sayfaları örnek veriyle çalışıyor. Arayüz henüz veritabanına bağlı değil (aşama 5–6: backend API).
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

# Arayüzü geliştirme modunda başlat → http://localhost:3000
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

## Klasör yapısı

```
apps/web    Next.js arayüzü (şimdilik örnek veri kaynağıyla)
apps/api    Fastify backend — aşama 5
packages/   config (ortak TS ayarları), db (şema, migration, seed),
            shared (API sözleşmesi, skor hesabı, kategoriler, örnek konular)
infra/      lokal docker-compose
docs/       mimari ve kararlar
```

## Güvenlik

- Gerçek anahtar/şifreler yalnızca `.env` dosyasında tutulur; `.env` `.gitignore` ile hariç tutulur.
- Güvenlik açığı bildirimi için repo sahibiyle doğrudan iletişime geçin.
