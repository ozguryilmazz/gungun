# gundemci.org — Mimari ve MVP Planı (v0.1, taslak)

> Durum: **Plan onaylandı (2026-10-05).** Kararlar en alttaki “Alınan kararlar” bölümünde. Aşama 1–6 tamamlandı (iskelet, veritabanı, tasarım, arayüz, backend API, arayüz ↔ API).
> Tarih: 2026-10-05

---

## 0. Değişmez ilkeler

1. **Sahte canlı veri yok.** Gerçek kaynağı olmayan metrik gösterilmez; yerine “Veri bekleniyor” / “Bu veri şu anda güncellenemiyor” gösterilir.
2. **Mock/seed veri işaretlidir.** Veritabanında `is_mock` alanı; arayüzde tüm sayfalarda görünür “ÖRNEK VERİ” şeridi.
3. **İçerik kopyalanmaz.** Kaynaktan yalnızca başlık, URL, yayıncı adı ve yayın zamanı saklanır. Tam metin çekilmez (scraping yok); yalnızca RSS / resmi API.
4. **Gündem skoru ≠ önem.** Skor “ne kadar konuşuluyor”u ölçer; arayüzde bu açıkça belirtilir.
5. **Bir kaynak çökerse sistem çökmez.** Her sağlayıcı izole; hata yalnızca server loguna gider.
6. **Güvenlik baştan mimaride.** Frontend hiçbir üçüncü taraf API’ye ve hiçbir secret’a erişmez.

---

## A — Ürün mimarisi (çalışma mantığı)

```
 ┌─────────────── TOPLA ───────────────┐   ┌────────── ANLAMLANDIR ──────────┐   ┌──────── SUN ────────┐
 │ Google Trends (TR trend RSS)        │   │ 1. Normalize (başlık, zaman)    │   │ Ana sayfa (Top N)   │
 │ Haber RSS’leri (izinli liste)       │──▶│ 2. Tekrar ayıklama (URL/başlık) │──▶│ Yükselenler         │
 │ Sosyal sinyaller (ileride)          │   │ 3. Konu kümeleme                │   │ Düşenler (ileride)  │
 │ Manuel admin girişi                 │   │ 4. Sinyal hesaplama + skor      │   │ Konu detay sayfası  │
 └─────────────────────────────────────┘   │ 5. (Ops.) AI özet + doğrulama   │   │ Günlük arşiv        │
          ▲ zamanlanmış işler               │ 6. Snapshot (zaman serisi)      │   │ Kategori sayfası    │
          │ (ör. 10–15 dk)                  └─────────────────────────────────┘   └─────────────────────┘
```

**Konu (topic) yaşam döngüsü:**
`aday (candidate)` → eşik aşılırsa `yayında (published)` → sinyal düşerse `soğuyan (cooling)` → `arşiv (archived)`.
Admin her aşamada gizleyebilir / düzenleyebilir / birleştirebilir.

**Gündem Skoru (MVP formülü — şeffaf ve basit):**

```
skor = 100 × Σ(wᵢ × nᵢ) / Σ(wᵢ)    (yalnızca VERİSİ OLAN bileşenler üzerinden)
```

| Bileşen           | Ham ölçü                                                     | Ağırlık (başlangıç) | MVP’de var mı        |
| ----------------- | ------------------------------------------------------------ | ------------------- | -------------------- |
| Haber görünürlüğü | Son 6 saatte konuyu yazan **farklı** yayıncı sayısı          | 0.35                | ✅ RSS               |
| Yükselme hızı     | Son 1 saatteki kaynak sayısı / önceki 3 saat ortalaması      | 0.25                | ✅ RSS               |
| Arama ilgisi      | Google Trends TR trend listesinde yer alma + yaklaşık trafik | 0.30                | ✅ (erişilebilirse)  |
| Sosyal sinyal     | —                                                            | 0.10                | ❌ “Veri bekleniyor” |

- `nᵢ`: o anki aktif konular içinde log-ölçekli normalize değer (0–1).
- Kapsam gösterilir: _“Skor 3/4 sinyalden hesaplandı.”_
- Değişim yüzdesi yalnızca iki gerçek snapshot varsa hesaplanır (`şimdi` vs `3 saat önce`); yoksa gösterilmez.
- **Yükselenler:** hız bileşenine göre sıralanır; küçük tabandan doğan sahte “+900%”leri önlemek için minimum kaynak eşiği (örn. ≥3 yayıncı) uygulanır.

---

## B — Teknik mimari

```
                    ┌──────────────── Tarayıcı (mobil / desktop) ────────────────┐
                    └───────────────────────────┬────────────────────────────────┘
                                                │ HTTPS (prod) / http://localhost:3000 (dev)
                                   ┌────────────▼────────────┐
                                   │  apps/web  (Next.js)    │  SSR/ISR, SEO, admin arayüzü
                                   │  secret YOK, 3. taraf   │  Yalnızca kendi API’mizi çağırır
                                   │  çağrısı YOK            │  (server-side fetch)
                                   └────────────┬────────────┘
                                                │ iç ağ (dev: localhost:4000)
                ┌───────────────────────────────▼───────────────────────────────┐
                │ apps/api  (Node.js + Fastify, TypeScript) — MODÜLER MONOLİT   │
                │  ├─ Public API  /api/v1/*        (GET, rate limit, cache)     │
                │  ├─ Admin API   /api/admin/v1/*  (oturum + CSRF + rol + audit)│
                │  └─ Worker giriş noktası (aynı kod tabanı, ayrı process)      │
                │       Zamanlayıcı → Pipeline → Providers                      │
                │       ┌─────────────┬──────────────┬───────────────┐          │
                │       │TrendProvider│ NewsProvider │SocialProvider │ ...      │
                │       └──────┬──────┴──────┬───────┴───────┬───────┘          │
                │              │  güvenli HTTP istemcisi (SSRF korumalı,       │
                │              │  allowlist, timeout, boyut limiti, retry)      │
                │       AI modülü (opsiyonel, kapatılabilir) + Doğrulama katmanı│
                └──────┬───────────────────────┬───────────────────────────────┘
                       │                       │
              ┌────────▼────────┐     ┌────────▼────────┐        ┌────────────────────────┐
              │ PostgreSQL      │     │ Cache           │        │ Harici kaynaklar       │
              │ (asıl veri +    │     │ MVP: bellek içi │        │ Google Trends RSS,     │
              │  iş kuyruğu     │     │ LRU + HTTP cache│        │ haber RSS’leri,        │
              │  pg-boss)       │     │ Sonra: Redis    │        │ AI API (ops.)          │
              └─────────────────┘     └─────────────────┘        └────────────────────────┘
```

**Kritik kararlar:**

- **Frontend ↔ Backend ayrı process.** Next.js yalnızca sunum katmanı; iş mantığı ve tüm dış bağlantılar `apps/api`’de.
- **Worker aynı kod tabanında, ayrı process.** Veri toplama yükü public API’yi yavaşlatmaz; ama ayrı servis/repo karmaşası da yok.
- **MVP’de Redis yok.** Kuyruk için `pg-boss` (Postgres üzerinde), cache için bellek içi LRU + Next.js ISR. Birden fazla instance’a geçince Redis eklenir (arayüzler buna göre soyutlanır: `CacheStore`, `RateLimitStore`).
- **Nginx MVP’de yok.** Lokal geliştirmede gereksiz; staging/prod aşamasında reverse proxy (Nginx veya Caddy) eklenecek.
- **Provider sözleşmesi:** her sağlayıcı `fetch() → Result<NormalizedItem[], ProviderError>` döner, kendi timeout/retry/circuit-breaker’ına sahiptir, durumu `fetch_runs` tablosuna yazılır.

---

## C — Klasör yapısı (pnpm workspace monorepo)

```
gungun/
├─ apps/
│  ├─ web/                         # Next.js (App Router)
│  │  ├─ src/app/
│  │  │  ├─ (public)/
│  │  │  │  ├─ page.tsx            # Ana sayfa
│  │  │  │  ├─ gundem/[slug]/      # Konu detay  (/gundem/iran-abd-gerilimi)
│  │  │  │  ├─ kategori/[slug]/    # /kategori/ekonomi
│  │  │  │  ├─ arsiv/[date]/       # /arsiv/2026-10-05
│  │  │  │  └─ yukselenler/
│  │  │  ├─ (admin)/yonetim/       # Admin arayüzü (noindex)
│  │  │  ├─ sitemap.ts, robots.ts
│  │  ├─ src/components/           # UI bileşenleri (TopicCard, ScoreBadge, TrendIndicator…)
│  │  ├─ src/lib/api-client.ts     # Yalnızca kendi API’mize server-side istek
│  │  └─ src/styles/
│  └─ api/                         # Fastify backend
│     ├─ src/
│     │  ├─ server.ts              # HTTP giriş noktası
│     │  ├─ worker.ts              # Zamanlanmış işler giriş noktası
│     │  ├─ config/                # env doğrulama (zod), tek yerden okunur
│     │  ├─ plugins/               # güvenlik başlıkları, rate limit, CORS, auth, hata yönetimi
│     │  ├─ modules/
│     │  │  ├─ topics/             # route + service + repository
│     │  │  ├─ categories/
│     │  │  ├─ archive/
│     │  │  └─ admin/              # auth, topic yönetimi, provider durumu, audit
│     │  ├─ providers/
│     │  │  ├─ types.ts            # TrendProvider / NewsProvider / SocialProvider arayüzleri
│     │  │  ├─ google-trends/
│     │  │  ├─ rss-news/
│     │  │  └─ social/             # şimdilik boş iskelet
│     │  ├─ pipeline/              # normalize → dedupe → cluster → score → summarize → validate
│     │  ├─ lib/                   # safe-http (SSRF), logger (redaction), slug, time
│     │  └─ jobs/
│     └─ test/                     # unit + integration + security testleri
├─ packages/
│  ├─ db/                          # Drizzle şema, migration’lar, seed (is_mock=true)
│  ├─ shared/                      # zod şemaları + ortak tipler (API sözleşmesi)
│  └─ config/                      # tsconfig / eslint / prettier ortak ayarları
├─ infra/
│  └─ docker-compose.yml           # Lokal Postgres (ileride Redis, proxy)
├─ docs/                           # Mimari, kararlar (ADR), API dokümanı
├─ .env.example                    # Gerçek değer içermez
├─ .gitignore                      # .env* (örnek hariç) kesin hariç
└─ README.md
```

---

## D — Veritabanı (MVP)

İhtiyaçtan türetilmiş, normalize şema. Önerilen listedeki `topic_scores` + `topic_history` tek bir **`topic_snapshots`** tablosunda birleşti; `users` tablosu MVP’de yok (public hesap yok), yalnızca `admin_users`.

```
categories ──< topics ──< topic_snapshots
                 │  └──< timeline_events
                 └──< topic_items >── source_items >── publishers
                                          │
data_providers ──< fetch_runs             └── data_providers
admin_users ──< admin_sessions
admin_users ──< audit_logs
```

| Tablo               | Temel alanlar                                                                                                                                                                                                                         | Not                                                                             |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| **categories**      | id, slug (uniq), name, sort_order                                                                                                                                                                                                     | 12 sabit kategori, seed ile                                                     |
| **topics**          | id, slug (uniq), title, category_id, summary, reasons (jsonb, doğrulanmış madde listesi), status (`candidate/published/cooling/archived/hidden`), summary_origin (`manual/ai/none`), is_mock, first_seen_at, published_at, updated_at | Slug değişirse eski slug → 301 için `previous_slugs`                            |
| **topic_snapshots** | id, topic_id, captured_at, score (0–100, null olabilir), components (jsonb: her bileşen değer+kaynak+`available`), coverage (örn. 3/4), rank, is_mock                                                                                 | Trend, yükselen/düşen, arşiv buradan türetilir. `(topic_id, captured_at)` index |
| **publishers**      | id, name, domain (uniq), homepage_url, is_active                                                                                                                                                                                      | Yayıncı = haber sitesi                                                          |
| **source_items**    | id, publisher_id, provider_id, url, url_hash (uniq), title, published_at, fetched_at                                                                                                                                                  | **Gövde metni saklanmaz**                                                       |
| **topic_items**     | topic_id, source_item_id, relevance, added_at                                                                                                                                                                                         | PK (topic_id, source_item_id)                                                   |
| **timeline_events** | id, topic_id, occurred_at, type (`first_source/search_spike/top5/...`), source_item_id (null olabilir)                                                                                                                                | Yalnızca gerçek veriden otomatik üretilir                                       |
| **data_providers**  | id, key (`google_trends`, `rss_news`…), kind (`trend/news/social`), is_enabled, config (jsonb, secret YOK), last_success_at, last_error_at, consecutive_failures                                                                      | Feed URL’leri burada (allowlist)                                                |
| **fetch_runs**      | id, provider_id, started_at, finished_at, status, items_fetched, error_code, error_message (temizlenmiş)                                                                                                                              | Admin “kaynak durumu” ekranı                                                    |
| **admin_users**     | id, email (uniq), password_hash (argon2id), role (`admin/editor`), totp_secret_enc (ileride), is_active, last_login_at                                                                                                                |                                                                                 |
| **admin_sessions**  | id, user_id, token_hash, expires_at, created_at, ip_hash                                                                                                                                                                              | Ham token DB’de tutulmaz                                                        |
| **audit_logs**      | id, admin_user_id, action, entity_type, entity_id, diff (jsonb), created_at                                                                                                                                                           | Admin her yazma işlemi                                                          |

**Aşama 2’de plana göre yapılan netleştirmeler:**

- `topic_slug_redirects` tablosu: eski slug → konu (301 yönlendirme için; `previous_slugs` alanı yerine).
- RSS adresi `publishers.feed_url` alanında; aktif yayıncıların feed adresleri SSRF allowlist’idir.
- `provider_kind` enum’una `manual` eklendi (admin girişi ve seed verisi için).
- `publishers`, `source_items`, `timeline_events` tablolarına da `is_mock` eklendi; örnek veri her katmanda ayırt edilebilir.
- Snapshot bileşenlerinde verisi olmayan sinyal `available=false`; hiç sinyal yoksa `score = null`.
- Kısıtlar veritabanı seviyesinde: slug formatı, skor 0–100, yalnızca `https` feed, yalnızca `http(s)` kaynak linki, büyük/küçük harf duyarsız benzersiz admin e-postası.

Veri saklama: `source_items` ve `topic_snapshots` için ileride bölümleme (aylık partition) ve eski snapshot’ların günlük özete sıkıştırılması.

---

## E — API (MVP)

Tüm yanıtlar JSON, şema `packages/shared` içindeki zod tanımlarıyla doğrulanır. Hata formatı tek tip: `{ error: { code, message } }` — `message` kullanıcı dostu Türkçe, teknik detay yok.

**Public — `/api/v1`** (yalnızca GET, IP başına rate limit, `Cache-Control` + ETag)

| Method | Endpoint                           | Açıklama                                                 |
| ------ | ---------------------------------- | -------------------------------------------------------- |
| GET    | `/topics?category=&limit=&cursor=` | Güncel gündem listesi (skora göre)                       |
| GET    | `/topics/rising?window=3h`         | Yükselenler                                              |
| GET    | `/topics/falling?window=3h`        | Düşenler (iskelet; veri yeterliyse)                      |
| GET    | `/topics/:slug`                    | Detay: özet, nedenler, skor bileşenleri, zaman çizelgesi |
| GET    | `/topics/:slug/sources?cursor=`    | Kaynak listesi (başlık, yayıncı, zaman, link)            |
| GET    | `/topics/:slug/history?range=24h`  | Skor zaman serisi (grafik için)                          |
| GET    | `/categories`                      | Kategori listesi                                         |
| GET    | `/archive/:date`                   | Günlük arşiv (`YYYY-MM-DD`, katı doğrulama)              |
| GET    | `/meta/status`                     | Hangi veri kaynakları aktif / güncel (kullanıcı dostu)   |
| GET    | `/health`                          | Liveness (detay vermez)                                  |

**Admin — `/api/admin/v1`** (oturum çerezi + CSRF token + rol kontrolü + audit log + sıkı rate limit)

| Method | Endpoint                | Açıklama                             |
| ------ | ----------------------- | ------------------------------------ |
| POST   | `/auth/login`           | Giriş (brute-force koruması)         |
| POST   | `/auth/logout`          | Çıkış                                |
| GET    | `/auth/me`              | Oturum bilgisi + CSRF token          |
| GET    | `/topics?status=&q=`    | Tüm konular (gizliler dahil)         |
| POST   | `/topics`               | Manuel konu ekleme                   |
| PATCH  | `/topics/:id`           | Başlık/özet/kategori/durum düzenleme |
| DELETE | `/topics/:id`           | Soft delete (`hidden`)               |
| POST   | `/topics/:id/merge`     | İki konuyu birleştirme               |
| GET    | `/providers`            | Kaynak durumları                     |
| PATCH  | `/providers/:id`        | Aç/kapat, feed listesi (allowlist)   |
| POST   | `/providers/:id/run`    | Manuel veri çekme tetikleme          |
| GET    | `/fetch-runs?provider=` | Çekme logları                        |
| GET    | `/audit-logs`           | Admin işlem geçmişi                  |

Admin ID’leri UUID; tüm sorgular sahiplik/rol kontrolünden geçer (IDOR önlemi). Kullanıcı yönetimi ve sistem logları ekranı MVP sonrası.

---

## F — Ana sayfa wireframe (metin)

**Mobil (öncelik, ~375px):**

```
┌─────────────────────────────────┐
│ gündemci              [☰]       │  ← sade wordmark, sticky üst bar
├─────────────────────────────────┤
│ ⚠ ÖRNEK VERİ — gerçek değildir  │  ← yalnızca mock modda
├─────────────────────────────────┤
│ BUGÜN TÜRKİYE’DE GÜNDEM         │
│ Son güncelleme: 4 dk önce       │
│                                 │
│ [Tümü][Türkiye][Dünya][Ekonomi]→│  ← yatay kaydırmalı kategori çipleri
├─────────────────────────────────┤
│ ┌─────────────────────────────┐ │
│ │ 1  DÜNYA              ▲ 91  │ │  ← sıra · kategori · skor rozeti
│ │ İran–ABD gerilimi           │ │
│ │ ███████████████████░  91/100│ │  ← skor çubuğu
│ │ 📈 Hızla yükseliyor  +42%/3s│ │
│ │ Açıklamalar sonrası haber   │ │
│ │ kaynaklarında belirgin artış│ │  ← 2 satır, kırpılır
│ │ 12 kaynak · 4 dk önce       │ │
│ │ [ Neden gündemde? → ]       │ │  ← tüm kart tıklanabilir, ≥48px hedef
│ └─────────────────────────────┘ │
│ ┌ 2 ... ┐                       │
│ ┌ 3 ... ┐                       │
├─────────────────────────────────┤
│ ŞU ANDA YÜKSELENLER             │
│ 1 Konu A            +64% ▲      │
│ 2 Konu B            +51% ▲      │
│ 3 Konu C            +43% ▲      │
├─────────────────────────────────┤
│ GÜNDEMDEN DÜŞENLER (ileride)    │
├─────────────────────────────────┤
│ Skor nasıl hesaplanır? · Arşiv  │
│ Hakkında · Kaynak politikası    │  ← footer
└─────────────────────────────────┘
```

**Desktop (≥1024px):** iki sütun — solda gündem kartları (geniş), sağda sticky “Yükselenler” + “Düşenler” + “Veri kaynakları durumu” paneli. Max içerik genişliği ~1200px.

**Detay sayfası (`/gundem/[slug]`) sırası:** breadcrumb → başlık + kategori → skor rozeti + değişim → kısa özet (etiket: _“Otomatik özet — kaynaklara dayanır”_ veya _“Editör özeti”_) → “Neden gündemde?” maddeleri → skor bileşenleri (her biri: değer **veya** “Veri bekleniyor”) → zaman çizelgesi (yalnızca gerçek olay varsa) → kaynaklar listesi (yayıncı · başlık · zaman · [Kaynağa git ↗], `rel="noopener nofollow"`).

**Görsel dil:** nötr zemin (açık gri/beyaz), tek vurgu rengi (derin mavi/turkuaz), skor için sıcaklık skalası yalnızca rozette; kırmızı yalnızca “düşüş” göstergesinde ve küçük. Sistem fontu veya tek variable font (Inter), büyük ama bağırmayan başlıklar. Dark mode: CSS değişkenleriyle hazır altyapı, MVP sonrası açılır.

**Logo (wordmark) alternatifleri** — UI aşamasında görsel olarak üretilecek:

1. `gündemci` — küçük harf, ü noktaları vurgu renginde _(önerilen: sade, akılda kalıcı)_
2. `gündemci●` — sonda canlılık noktası
3. `gündem/ci` — eğik çizgiyle teknoloji hissi

---

## G — MVP güvenlik checklist’i

**Mimari / Secret**

- [ ] Secret’lar yalnızca `.env` (lokal) / secret manager (prod); `.env*` `.gitignore`’da, yalnızca `.env.example` repoda
- [ ] Env değişkenleri açılışta zod ile doğrulanır; eksikse uygulama başlamaz
- [ ] Next.js’e yalnızca `NEXT_PUBLIC_` olmayan değişkenler server tarafında; frontend bundle’ında secret taraması (CI)
- [ ] GitHub secret scanning + push protection açık

**Girdi / Enjeksiyon**

- [ ] Tüm girdiler (query, params, body) zod şemasıyla doğrulanır; bilinmeyen alanlar reddedilir
- [ ] Yalnızca ORM / parametreli sorgu (SQL injection); ham SQL string birleştirme yasak (lint kuralı)
- [ ] Shell komutu çalıştırılmaz (command injection yüzeyi yok)
- [ ] Dosya sistemi kullanıcı girdisiyle erişilmez (path traversal); MVP’de dosya yükleme yok

**XSS / İçerik**

- [ ] React otomatik escape; `dangerouslySetInnerHTML` yasak (lint kuralı); JSON-LD güvenli serileştirme
- [ ] RSS’ten gelen başlıklar düz metne indirgenir (HTML strip), uzunluk sınırı
- [ ] Dış linkler yalnızca `http/https` şeması; `javascript:` vb. reddedilir
- [ ] Sıkı CSP (nonce tabanlı), `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, `frame-ancestors 'none'`; prod’da HSTS

**SSRF**

- [ ] Dış istekler yalnızca `safe-http` istemcisiyle: admin tanımlı domain allowlist, özel/loopback/link-local IP blokları (DNS çözümleme sonrası kontrol), yalnızca 80/443, redirect sınırı ve hedef yeniden doğrulama, timeout, yanıt boyutu limiti

**Kimlik doğrulama / Yetkilendirme**

- [ ] Admin şifreleri argon2id; giriş denemelerinde hesap+IP bazlı kademeli kilit
- [ ] Oturum: `HttpOnly`, `Secure` (prod), `SameSite=Strict` çerez; sunucu tarafı oturum, token hash’i DB’de; giriş sonrası oturum yenileme
- [ ] CSRF: admin yazma işlemlerinde double-submit token + `Origin` kontrolü
- [ ] Her admin endpoint’inde rol kontrolü (deny-by-default); UUID + yetki kontrolü (IDOR)
- [ ] Admin oluşturma yalnızca CLI/seed komutuyla (public kayıt endpoint’i yok)
- [ ] Admin arayüzü `noindex`; ileride IP kısıtı / 2FA

**API kötüye kullanım**

- [ ] Public: IP başına rate limit; admin: daha sıkı; login: en sıkı
- [ ] Sayfalama limitleri (max `limit`), cursor tabanlı
- [ ] CORS: yalnızca kendi origin’imiz; wildcard yok, credentials yalnızca admin origin’e
- [ ] İstek gövdesi boyut limiti

**Hata / Log**

- [ ] Kullanıcıya genel Türkçe mesaj; stack trace yalnızca server logunda
- [ ] Yapılandırılmış log (pino) + redaction: şifre, token, cookie, authorization, API key alanları maskelenir; IP’ler hash’lenir
- [ ] Her istekte `request_id`

**Bağımlılıklar**

- [ ] Lockfile commit; `pnpm audit` + Dependabot/Renovate; minimal bağımlılık ilkesi
- [ ] Docker imajlarında sabit sürüm, root olmayan kullanıcı

**Testler**

- [ ] Auth, yetki, CSRF, rate limit, input validation, SSRF engelleme, XSS payload’ları için otomatik testler

---

## H — Geliştirme sırası (her adımda onayınla ilerlenir)

| #   | Aşama                     | Çıktı                                                                                                     | Onay kapısı |
| --- | ------------------------- | --------------------------------------------------------------------------------------------------------- | ----------- |
| 0   | **Bu belge**              | Mimari plan                                                                                               | ✅          |
| 1   | Repo iskeleti             | pnpm workspace, tsconfig/eslint/prettier, `.gitignore`, `.env.example`, README, docker-compose (Postgres) | ✅          |
| 2   | Veritabanı                | Drizzle şema + migration + **işaretli** seed verisi                                                       | ✅          |
| 3   | UI wireframe → tasarım    | Wordmark alternatifleri, renk/tipografi token’ları, kart bileşeni prototipi                               | ✅          |
| 4   | İlk çalışan frontend      | Ana sayfa + detay + kategori (seed veriden, “ÖRNEK VERİ” şeridiyle)                                       | ✅          |
| 5   | Backend API               | Public endpoint’ler, validation, hata yönetimi, cache, rate limit, testler                                | ✅          |
| 6   | Frontend ↔ API bağlantısı | Mock’tan gerçek API’ye geçiş                                                                              | ✅          |
| 7   | Veri sağlayıcıları        | Provider arayüzü, safe-http, RSS + Google Trends adapter, worker, `fetch_runs`                            | ✋          |
| 8   | Pipeline + skor           | Dedupe, basit kümeleme, skor, snapshot, yükselenler/düşenler, arşiv                                       | ✋          |
| 9   | Admin                     | Auth, konu yönetimi, provider durumu, audit log                                                           | ✋          |
| 10  | Güvenlik sertleştirme     | Başlıklar/CSP, güvenlik testleri, bağımlılık denetimi                                                     | ✋          |
| 11  | SEO                       | Metadata, OG, JSON-LD, sitemap, robots, canonical                                                         | ✋          |
| 12  | Performans                | Lighthouse / Core Web Vitals, bundle analizi                                                              | ✋          |
| 13  | (Ops.) AI özet            | Ayrı modül + doğrulama katmanı, varsayılan kapalı                                                         | ✋          |
| 14  | Staging → Production      | Canlıya geçiş checklist’i; **production yalnızca açık onayınla**                                          | ✋          |

**AI doğrulama katmanı (aşama 13 için ön tasarım):** model yalnızca o konuya bağlı kaynak başlıklarını girdi olarak alır → çıktı katı JSON şeması → her cümle en az bir `source_item_id`’ye referans vermek zorunda → özetteki özel isim/sayılar kaynak başlıklarında geçmiyorsa reddedilir → yasaklı ifade/clickbait filtresi → başarısızsa özet yayınlanmaz (“Özet hazırlanıyor”), uydurma yerine boşluk tercih edilir. Arayüzde AI özetleri etiketlenir; admin düzeltebilir.

---

## I — Teknoloji seçimi

| Katman     | Seçim                                                       | Neden                                                                                                                                      | Alternatif / Neden değil                                                                                                         |
| ---------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| Dil        | **TypeScript** (her yerde)                                  | Tek dil, ortak tipler (`packages/shared`), tek kişilik ekipte bakım kolaylığı                                                              | Python: NLP için güçlü, ama iki dil + iki ekosistem MVP’de maliyet. Kümeleme ileride ağırlaşırsa ayrı Python servisi eklenebilir |
| Frontend   | **Next.js (App Router)**                                    | SSR/ISR → SEO + hız; Server Components → az JS                                                                                             | Astro: daha az JS ama admin/etkileşim için zayıf                                                                                 |
| Backend    | **Fastify (ayrı Node.js app)**                              | Hızlı, şema tabanlı validation, olgun güvenlik eklentileri (helmet, rate-limit, cors, cookie); frontend’den net ayrım; worker ile aynı kod | Next.js API routes: kolay ama frontend/backend ayrımı bulanıklaşır, worker için uygun değil. FastAPI: yukarıdaki dil gerekçesi   |
| ORM        | **Drizzle**                                                 | SQL’e yakın, hafif, tip güvenli, parametreli sorgular, migration’lar                                                                       | Prisma: popüler ama daha ağır runtime                                                                                            |
| Validation | **zod**                                                     | Frontend + backend ortak şema                                                                                                              | —                                                                                                                                |
| DB         | **PostgreSQL 17**                                           | İlişkisel model, jsonb, full-text (Türkçe), ileride partitioning                                                                           | —                                                                                                                                |
| Kuyruk     | **pg-boss**                                                 | Ek altyapı istemez (Postgres)                                                                                                              | BullMQ + Redis: ölçek gerektiğinde                                                                                               |
| Cache      | **Bellek içi LRU + Next ISR + HTTP cache**                  | MVP için yeterli, sıfır operasyon                                                                                                          | Redis: çoklu instance’a geçince                                                                                                  |
| Log        | **pino**                                                    | Hızlı, yapılandırılmış, redaction desteği                                                                                                  | —                                                                                                                                |
| Test       | **Vitest** + Fastify `inject` + **Playwright** (birkaç e2e) | Hızlı, TS uyumlu                                                                                                                           | Jest                                                                                                                             |
| Paket yön. | **pnpm workspaces**                                         | Monorepo için hızlı, disk dostu                                                                                                            | npm workspaces                                                                                                                   |
| Runtime    | **Node.js 24 LTS**                                          | Güncel LTS                                                                                                                                 | —                                                                                                                                |
| Container  | **Docker Compose** (yalnızca Postgres, lokal)               | Windows’ta Node’u native çalıştırmak geliştirmede daha hızlı                                                                               | Her şeyi container’da çalıştırmak: Windows’ta dosya izleme yavaş                                                                 |
| Proxy      | Staging/prod’da **Caddy** veya **Nginx**                    | Caddy: otomatik HTTPS, basit config                                                                                                        | MVP’de gereksiz                                                                                                                  |

**Lokal çalışma (Windows):** `pnpm db:up` (Postgres) → `pnpm dev` → web `http://localhost:3000`, api `http://localhost:4000` (api yalnızca `127.0.0.1`’e bağlanır).

---

## Alınan kararlar (2026-10-05)

| Konu         | Karar                                                                                                                                    |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Docker       | Docker Desktop kurulu → Postgres `infra/docker-compose.yml` ile çalışır                                                                  |
| URL yapısı   | Konu: `/gundem/[slug]` · Arşiv: `/arsiv/YYYY-MM-DD` · Kategori: `/kategori/[slug]`                                                       |
| Paket yön.   | pnpm (sürüm `package.json` → `packageManager` alanında sabit, Corepack ile kurulur)                                                      |
| Logo / renk  | Logo **C** (kare “g” işareti + “gündemci”), vurgu rengi `#0B5C7A`; yazı: Schibsted Grotesk + IBM Plex Mono (npm’den, kendi sunucumuzdan) |
| AI özet      | MVP’de **kapalı** (`AI_SUMMARY_ENABLED=false`); sağlayıcı/bütçe kararı aşama 13’te                                                       |
| Veri kaynağı | Google Trends TR trend RSS + aşağıdaki haber RSS’leri. Yalnızca başlık/link/zaman alınır, tam metin çekilmez                             |

### MVP haber kaynakları (RSS)

Seçim ölçütü: Türkiye’de en çok takip edilen siteler + **farklı yayın çizgilerinden dengeli dağılım** (tarafsızlık ilkesi gereği tek bir çizgiye yaslanan kaynak seti skoru çarpıtır) + uluslararası yayıncıların Türkçe servisleri.

| #   | Yayıncı         | Tür                   | Aday RSS adresi                                        |
| --- | --------------- | --------------------- | ------------------------------------------------------ |
| 1   | Anadolu Ajansı  | Haber ajansı (kamu)   | `https://www.aa.com.tr/tr/rss/default?cat=guncel`      |
| 2   | TRT Haber       | Kamu yayıncısı        | `https://www.trthaber.com/sondakika.rss`               |
| 3   | NTV             | Ana akım TV           | `https://www.ntv.com.tr/gundem.rss`                    |
| 4   | CNN Türk        | Ana akım TV           | `https://www.cnnturk.com/feed/rss/all/news`            |
| 5   | Habertürk       | Ana akım              | `https://www.haberturk.com/rss`                        |
| 6   | Hürriyet        | Ana akım gazete       | `https://www.hurriyet.com.tr/rss/anasayfa`             |
| 7   | Milliyet        | Ana akım gazete       | `https://www.milliyet.com.tr/rss/rssnew/gundemrss.xml` |
| 8   | Sabah           | Gazete                | `https://www.sabah.com.tr/rss/gundem.xml`              |
| 9   | Sözcü           | Gazete                | `https://www.sozcu.com.tr/feeds-rss-category-sozcu`    |
| 10  | Cumhuriyet      | Gazete                | `https://www.cumhuriyet.com.tr/rss/son_dakika.xml`     |
| 11  | BBC News Türkçe | Uluslararası (Türkçe) | `https://feeds.bbci.co.uk/turkce/rss.xml`              |
| 12  | DW Türkçe       | Uluslararası (Türkçe) | `https://rss.dw.com/rdf/rss-tur-all`                   |
| —   | Google Trends   | Arama trendi (TR)     | `https://trends.google.com/trending/rss?geo=TR`        |

**Önemli notlar:**

- Bu adresler **henüz doğrulanmadı** (geliştirme ortamının ağ politikası bu sitelere erişime izin vermedi). Aşama 7’de lokal makinede her biri test edilecek; çalışmayan adres sitenin güncel RSS sayfasından düzeltilecek.
- Liste koda gömülmez; `data_providers` / `publishers` tablolarında tutulur ve admin panelinden açılıp kapatılabilir. Bu liste aynı zamanda SSRF koruması için **domain allowlist**’tir.
- Her kaynağın kullanım şartları/robots.txt’si aşama 7’de kontrol edilir; istek sıklığı kaynak başına ≥10 dk, tanımlı `User-Agent` (`gundemciBot/0.1 (+https://gundemci.org/bot)`).
- Skor hesaplamasında “farklı yayıncı sayısı” kullanıldığı için tek bir kaynağın çok sayıda haberi skoru şişirmez.

### Aşama 4 notları

- `packages/shared`: API sözleşmesi (zod şemaları), skor formülü, trend sınıflandırması, kategoriler ve örnek konular. Veritabanı seed’i, arayüz ve ileride API aynı kodu kullanır.
- Arayüzün tek veri erişim noktası `apps/web/src/lib/data` (yalnızca sunucuda çalışır). Şu an örnek veri kaynağından okur ve her yanıtı sözleşme şemasıyla doğrular; aşama 6’da içi backend API çağrısına çevrilecek.
- Kategori filtresi JavaScript gerektirmez (her kategori kendi sayfası: `/kategori/[slug]`). Tarayıcıya gönderilen JavaScript yalnızca Next.js çekirdeği.
- Yazı tipleri Google’a istek atmadan kendi sunucumuzdan yüklenir (gizlilik + CSP `font-src 'self'`).
- Temel güvenlik başlıkları (CSP, X-Frame-Options, nosniff, Referrer-Policy, Permissions-Policy) şimdiden açık; nonce tabanlı sıkı CSP aşama 10’da.
- Site `noindex` — canlıya geçişe ve gerçek veriye kadar arama motorlarına kapalı.
- `/arsiv` sayfaları aşama 8’de (snapshot verisi oluşunca); şimdilik menüde yok.

### Aşama 5 notları

- `apps/api`: Fastify, yalnızca `127.0.0.1`’e bağlanır. Rotalar `/api/v1` altında, yalnızca `GET`.
- Katmanlar: `repository` (parametreli SQL) → `service` (sıralama, değişim, yükselen/düşen, önbellek) → `routes` (girdi doğrulama + yanıtı sözleşme şemasıyla doğrulama).
- “3 saat önceki” ölçüm: en son ölçümden en az 2,5 saat önce alınmış en yeni ölçüm (30 dk tolerans). Yoksa değişim gösterilmez.
- Önbellek: bellek içi TTL (varsayılan 30 sn), eşzamanlı aynı istekler tek sorguda birleşir.
- Güvenlik: helmet (en sıkı CSP), CORS kapalı (API’yi yalnızca web sunucusu çağırır), IP başına rate limit, bilinmeyen sorgu parametreleri ve geçersiz slug veritabanına ulaşmadan reddedilir, istek kimliği sunucuda üretilir, loglarda IP / çerez / yetki başlığı yok.
- **Rate limit notu:** API’yi tarayıcılar değil web sunucusu çağırdığı için tüm istekler web sunucusunun IP’sinden gelir; bu IP `RATE_LIMIT_ALLOWLIST` ile muaf tutulur. Ziyaretçi bazlı rate limit aşama 10’da web/proxy katmanında uygulanacak.
- Hata dayanıklılığı test edildi: veritabanı kapanınca API çökmez, genel mesaj döner (`/health/ready` → 503), veritabanı dönünce kendiliğinden toparlanır.

### Aşama 6 notları

- Arayüzün geçici örnek veri kaynağı kaldırıldı; tüm veri `apps/web/src/lib/data` → API’den gelir ve sözleşme şemalarıyla doğrulanır (sözleşmeye uymayan yanıt, ör. `javascript:` bağlantı, reddedilir).
- API istemcisi: yalnızca sunucuda, 5 sn zaman aşımı, yönlendirme izlenmez, adres yalnızca `API_INTERNAL_URL`’den (kimlik bilgisi içermeyen http/https), yollar kod içinde sabit + `encodeURIComponent`.
- Hata davranışı: ana liste alınamazsa “Bu veri şu anda güncellenemiyor” sayfası; yükselenler / düşenler / kaynak durumu gibi yan bölümler alınamazsa yalnızca o bölüm bu mesajı gösterir. Daha önce alınmış veri önbellekten (30 sn) gösterilmeye devam edebilir.
- Geçersiz konu adresi ve bilinmeyen kategori API’ye gitmeden 404.
- Sayfalar dinamik (her istekte API, fetch önbelleği 30 sn) — derleme sırasında API’nin çalışması gerekmez.
- Geliştirme ve `start` sunucusu yalnızca `127.0.0.1`’e bağlanır (ağdaki diğer cihazlar erişemez).
- API’de `RATE_LIMIT_ALLOWLIST` varsayılanı `127.0.0.1,::1` (aynı bilgisayardaki web sunucusu).
- Kenar çubuğuna “Veri kaynakları” durumu eklendi (tasarımdaki panel); şu an tümü “Henüz bağlanmadı”.
