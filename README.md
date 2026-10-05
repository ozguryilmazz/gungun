# gundemci.org

Türkiye'de internette **ne konuşuluyor, neden gündemde ve ne kadar hızlı yükseliyor** sorusuna yanıt veren gündem analiz platformu.

> Durum: **Aşama 1 — repo iskeleti.** Henüz uygulama kodu yok.
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
```

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
packages/   config (ortak TS ayarları); db ve shared sonraki aşamalarda
infra/      lokal docker-compose
docs/       mimari ve kararlar
```

## Güvenlik

- Gerçek anahtar/şifreler yalnızca `.env` dosyasında tutulur; `.env` `.gitignore` ile hariç tutulur.
- Güvenlik açığı bildirimi için repo sahibiyle doğrudan iletişime geçin.
