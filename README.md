# gundemci.org

Türkiye'de internette **ne konuşuluyor, neden gündemde ve ne kadar hızlı yükseliyor** sorusuna yanıt veren gündem analiz platformu.

> Durum: **Aşama 2 — veritabanı.** Şema, migration ve işaretli örnek veri hazır; arayüz henüz yok.
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
apps/       web (Next.js) ve api (Fastify) — sonraki aşamalarda
packages/   config (ortak TS ayarları), db (şema, migration, seed); shared sonraki aşamalarda
infra/      lokal docker-compose
docs/       mimari ve kararlar
```

## Güvenlik

- Gerçek anahtar/şifreler yalnızca `.env` dosyasında tutulur; `.env` `.gitignore` ile hariç tutulur.
- Güvenlik açığı bildirimi için repo sahibiyle doğrudan iletişime geçin.
