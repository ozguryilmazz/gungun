# gundemci.org — Arama Öncelikli Yapı Planı (v0.2, onaylandı)

> Tarih: 2026-10-05 · Bu belge `01-mimari-plan.md`’deki ürün mantığını değiştirir; altyapı (veri toplama,
> güvenlik, API, arayüz, arşiv) aynen kalır.

## 1. Neden değişiyor?

|                 | Şu anki yapı (v0.1)             | Yeni yapı (v0.2)                                                 |
| --------------- | ------------------------------- | ---------------------------------------------------------------- |
| Soru            | Haber sitelerinde ne yazılıyor? | **İnsanlar şu an ne arıyor ve ne konuşuyor?**                    |
| Ana kaynak      | Haber RSS’leri                  | **Google Trends** (Türkiye arama trendleri)                      |
| Haberlerin rolü | Konuyu oluşturur                | **Konuyu açıklar** (“Neden gündemde?” + kaynaklar)               |
| Sosyal sinyal   | Yok                             | **YouTube Türkiye trendleri** (+ ileride X, koşullu Ekşi Sözlük) |

## 2. Veri kaynakları ve rolleri

| Kaynak                               | Rol                                                                         | Erişim                                                                                      | Güncellik                                                   | Durum                          |
| ------------------------------------ | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | ------------------------------ |
| **Google Trends TR**                 | **Ana sinyal:** her trend arama bir gündem konusudur                        | Herkese açık trend RSS (resmi)                                                              | Google tarafında yaklaşık saatlik; biz 10 dk’da bir bakarız | Var (aşama 7)                  |
| **YouTube Türkiye trendleri**        | Ayrı bölüm + sosyal sinyal                                                  | Resmi YouTube Data API v3 (`chart=mostPopular`, `regionCode=TR`), **ücretsiz API anahtarı** | 15–30 dk                                                    | **Yeni**                       |
| **Haber RSS (19 site)**              | Açıklama: trend aramayla eşleşen haberler                                   | Resmi RSS                                                                                   | 10–15 dk                                                    | Var                            |
| **Trends “ilgili haberler”**         | Açıklama: Google’ın trend terimle ilişkilendirdiği haberler (kaynak adıyla) | Trends RSS içinde                                                                           | Trends ile aynı                                             | Var, şu an yalnızca saklanıyor |
| **Türkçe Vikipedi en çok okunanlar** | Destek sinyali: “neyi merak ediyoruz?”                                      | Resmi Wikimedia API, anahtarsız                                                             | **Günlük** (bir önceki gün) — anlık değil                   | İsteğe bağlı                   |
| **Ekşi Sözlük “gündem” başlıkları**  | Sosyal sinyal (yalnızca başlık + entry sayısı, bağlantı)                    | API yok — **yalnızca kullanım koşulları ve robots.txt izin veriyorsa**                      | 15 dk                                                       | **Koşullu** (bkz. §6)          |
| **X (Twitter)**                      | Sosyal sinyal                                                               | Resmi API, **ücretli**                                                                      | Paket bağlı                                                 | Bütçe kararıyla, ileride       |

“Anlık” konusunda dürüstlük: Google Trends RSS’i gerçek zamanlı değil, yaklaşık saatlik güncellenir. Arayüzde
her konu için “son güncelleme” zamanı gösterilir; “canlı” ifadesi kullanılmaz.

## 3. Yeni konu modeli

1. **Trend konu:** Google Trends’teki her terim bir konudur (ör. “galatasaray”, “deprem”).
   - Başlık: terimin kendisi (ör. “Galatasaray”); altında, eşleşen en güncel haber başlığı **kaynak adıyla**
     (“Hürriyet: …”) gösterilir. Kendi cümlemizi yazmayız.
   - “Neden gündemde?”: ölçülen bilgiler + eşleşen haberler + Google’ın ilgili haberleri.
2. **Haber konusu (ikincil):** Arama trendinde olmayan ama ≥ 4 yayıncıda geçen olaylar ayrı bir bölümde
   (“Haberlerde öne çıkanlar”) gösterilir; ana listeye karışmaz.
3. **Eşleştirme:** Trend terim ↔ haber kümesi eşleşmesi aşama 8’deki kurallarla (medya adları hariç, tek
   kelimede iyelik eki yok) yapılır. Eşleşen haber kümesi trend konusuna bağlanır.
4. **Yaşam döngüsü:** Terim Trends listesinde olduğu sürece “yayında”; listeden çıkınca “soğuyan”
   (3 saat), sonra arşiv.

## 4. Yeni skor (ağırlıklar)

| Bileşen           | Ağırlık  | Ölçüm                                                             |
| ----------------- | -------- | ----------------------------------------------------------------- |
| Arama ilgisi      | **0,50** | Trends yaklaşık trafiği (log ölçek) + listede kalma süresi        |
| Sosyal sinyal     | **0,25** | YouTube trendinde eşleşen video (sıra, izlenme); ileride X / Ekşi |
| Haber görünürlüğü | 0,15     | Eşleşen haberlerin farklı yayıncı sayısı                          |
| Yükselme hızı     | 0,10     | Trafik / sıra değişimi (son 3 saat)                               |

Verisi olmayan bileşen yine skora katılmaz ve “Veri bekleniyor” gösterilir (değişmeyen ilke).

## 5. YouTube bölümü

- **Ana sayfada** “YouTube’da Türkiye trendleri” bölümü (ilk 10), ayrıca `/youtube` sayfası (ilk 50).
- **Gösterilenler:** sıra, video başlığı, kanal adı, izlenme sayısı, yayın zamanı, küçük resim ve
  YouTube’daki videoya bağlantı. Video sitemizde oynatılmaz; tıklayınca YouTube’a gidilir.
- **YouTube API Hizmet Şartları:** Başlık ve kanal adı değiştirilmeden gösterilir, YouTube kaynak olarak
  belirtilir, veriler en geç birkaç saatte bir yenilenir (şartlar en fazla 30 gün tutulmasına izin verir).
- **Güvenlik:**
  - API anahtarı yalnızca sunucuda (`.env` → `YOUTUBE_API_KEY`), tarayıcıya gitmez.
  - Anahtar adres içinde gittiği için hiçbir log satırına adres yazılmaz.
  - Küçük resimler için CSP’ye yalnızca `i.ytimg.com` eklenir.
- **Kota:** Ücretsiz günlük kota 10.000 birim; bir liste çağrısı 1 birim. 15 dk’da bir çağrı günde ~100 birim eder, kota rahat yeter.

## 6. Ekşi Sözlük (koşullu)

Ekşi Sözlük’ün herkese açık API’si yok; “gündem” sayfası okunabilir ama:

1. **Kullanım koşulları:** Otomatik veri toplamayı yasaklıyorsa bu kaynak **eklenmez**
   (“izinsiz kopyalama yok” ilkesi). Bunu kullanıcı siteden okuyup karar verir; gerekirse Ekşi’den
   yazılı izin istenir.
2. **robots.txt:** Sağlayıcı her çalışmada `robots.txt`’i okur; gündem sayfası botlara kapalıysa
   **çalışmaz** ve durumu “izin yok” olarak gösterir.
3. **Bot koruması:** Site tarayıcı dışı istekleri engelliyorsa bu engel **aşılmaya çalışılmaz**
   (tarayıcı taklidi, korumayı atlatma yok).
4. İzin varsa yalnızca **başlık + entry sayısı + bağlantı** alınır; entry metinleri alınmaz.

## 7. X (ileride)

Mimari hazır: `SocialProvider` olarak eklenir. Bütçe kararı verildiğinde güncel fiyat ve paket
özellikleri (trend verisi hangi pakette?) birlikte incelenir.

## 8. Değişecek / kalacak parçalar

- **Kalır:** veri toplama altyapısı, SSRF koruması, haber RSS, API katmanı, arayüz tasarımı, arşiv, testler.
- **Değişir:** konu oluşturma (trend öncelikli), skor ağırlıkları, ana sayfa bölümleri (Trend gündem →
  YouTube → Haberlerde öne çıkanlar), konu detayındaki açıklama bölümü.
- **Veritabanı:**
  - `topics.kind` (`trend` / `news`) eklenir.
  - `youtube_videos` tablosu eklenir: sıra geçmişi ile video, kanal, izlenme.
  - `source_items.source_name` eklenir: Google’ın ilgili haberleri bizim yayıncı listemizde olmayan sitelerden gelebilir.

## 9. Uygulama sırası (her adım onaylı)

| #   | Adım                                     | Çıktı                                                    |
| --- | ---------------------------------------- | -------------------------------------------------------- |
| 9.1 | Trend öncelikli konu modeli + yeni skor  | Ana liste Google Trends terimlerinden; haberler açıklama |
| 9.2 | YouTube sağlayıcısı + bölüm              | Ana sayfa bölümü, `/youtube`, sosyal sinyal              |
| 9.3 | (İsteğe bağlı) Vikipedi en çok okunanlar | Günlük destek sinyali                                    |
| 9.4 | (Koşullu) Ekşi Sözlük                    | Yalnızca izin varsa                                      |
| 10  | Admin paneli                             | (eski aşama 9)                                           |

Sonraki aşamaların numaraları birer kayar: güvenlik sertleştirme 11, SEO 12, performans 13, AI 14, canlıya geçiş 15.

## 10. Uygulama notları

### 9.1 (tamamlandı)

- **Konu türü (`topics.kind`):** `trend` ana liste, `news` “Haberlerde öne çıkanlar”. Her arama terimi `topics.trend_key` ile tek konudur (migration `0002_trend_first`).
- **Trend konusu:**
  - Başlık terimin kendisidir (“ali koç” → “Ali Koç”).
  - Eşleşen haber kümesi ve Google’ın ilgili haberleri (`source_items.source_name`) konuya bağlanır.
  - Kartta en güncel haber başlığı kaynağıyla gösterilir.
- **Haber konusu:** Aramayla eşleşmeyen, en az 4 yayıncıda geçen olaylar. Bir aramayla eşleşen küme ayrı haber konusu olarak gösterilmez.
- **Yaşam döngüsü:** Arama listede oldukça “yayında”; listeden çıkınca “soğuyan”, 3 saat sonra arşiv. Trends verisi 2 saatten eskiyse liste güncel sayılmaz.
- **Zaman çizelgesi:** “Google Türkiye trend listesine girdi” ve “Trend listesinden çıktı” olayları eklendi.
- **Gruplama iyileştirmeleri:**
  - Ana kelimeler, küme büyüyünce en az 2 başlıkta geçenlerdir.
  - Birleşme eşiği: 3+ ortak kelimede 0,5; yalnızca 2 ortak kelimede 0,6.
  - Başlık kapsamı en az %25.

### 9.2 (tamamlandı)

- **Sağlayıcı `youtube_trending`:** Resmi YouTube Data API v3 (`chart=mostPopular`, `regionCode=TR`), 20 dk’da bir, kapalı başlar.
  - API anahtarı `.env` → `YOUTUBE_API_KEY`; adrese değil `X-Goog-Api-Key` başlığına konur. Böylece hiçbir log ya da hata kaydında görünmez. Başlık yalnızca `www.googleapis.com`’a gider; başka host’a yönlendirmede düşürülür.
  - Yanıt zod ile doğrulanır. Küçük resim yalnızca `i.ytimg.com`’dan kabul edilir. 30 günden eski kayıtlar silinir (YouTube API şartları).
- **Veritabanı:** `youtube_videos` tablosu (migration `0003_youtube`).
- **API:** `GET /api/v1/youtube?limit=` — en güncel liste. 24 saatten eski liste gösterilmez.
- **Arayüz:** Ana sayfada “YouTube’da Türkiye trendleri” (ilk 10) ve `/youtube` (ilk 50). Video sitede oynatılmaz; bağlantı YouTube’a gider. Kaynak olarak YouTube belirtilir.
- **Sosyal sinyal (skorun %25’i):** Trend terimi YouTube trend videolarının başlığında geçiyorsa en iyi sıraya göre değer alır (1. sıra = 1,0; 50. sıra ≈ 0,3; her ek video +0,1, en fazla +0,2). Geçmiyorsa 0. YouTube listesi 2 saatten eskiyse “Veri bekleniyor”. Haber konularında sosyal sinyal ölçülmez.

### Açıklaması olmayan aramalar ve haber araması (GDELT — kaldırıldı)

- **Sıralama:** Trend listesinde önce aramayı açıklayan en az bir haberi olan konular, sonra açıklaması bulunamayanlar gelir. Her grup kendi içinde skora göre sıralanır; skor değişmez. Kartta “açıklayan haber henüz bulunamadı” notu gösterilir.
- **İlk deneme: Google Haberler (kaldırıldı).** `news.google.com/robots.txt` tüm botlara `Disallow: /` diyor; `/rss/search` izinli yollar arasında değil. Sağlayıcı robots.txt denetimi sayesinde hiç istek atmadı ve kaldırıldı (`RETIRED_PROVIDER_KEYS`, seed sırasında silinir).
- **GDELT (kaldırıldı, kullanıcı kararı):** `gdelt_news` sağlayıcısı GDELT DOC 2.0 API’sinde trend terimlerini arıyordu. İstek sınırı (5 sn’de bir) çok dar olduğu için tek istekte bile sık sık 429 alındı ve kaldırıldı. Migration `0006_retire_gdelt` GDELT’in bulduğu haber kayıtlarını, sağlayıcı kaydını ve `trend_news_links` / `trend_news_searches` tablolarını siler. Ortak arama kodu (`news-search.ts`) da kaldırıldı.
- **Değerlendirilip reddedilenler:** pytrends ve ücretli SERP servisleri (SerpApi vb.) Google’ı kazıyıp bot korumasını aştığı için kullanılmaz. Google Trends API (alpha) şimdilik beklemede.

### Arama filtresi (gündem başlığı olamayacak aramalar)

Kural tabanlı (`apps/api/src/topics-pipeline/term-filter.ts`), yapay zekâ yok:

| Karar                    | Örnekler                                                                                                        |
| ------------------------ | --------------------------------------------------------------------------------------------------------------- |
| Elenir: site/marka/kanal | memurlar net, mynet, milliyet, sözcü gazetesi, trendyol, transfermarkt, trt spor, alan adı yazılmış aramalar    |
| Elenir: canlı yayın      | “… canlı”, “… canlı izle”, “… izle”                                                                             |
| Elenir: rutin hizmet     | “… hava durumu”, imsak, yatsı namazı, “… fiyatı/fiyatları”, faiz oranları, “hangi diziler var”, “… çöktü mü”    |
| Elenir: yasa dışı        | betplay ve benzeri bahis siteleri, iptv, korsan maç yayınları                                                   |
| Elenir: yabancı dil      | Latin dışı alfabeler, “… vs …”, Almanca maç adları, İngilizce genel kelimeler                                   |
| Elenir: tarih/gün        | 2026, pazartesi, 3 ekim                                                                                         |
| Yalnızca haberle         | Tek kelimelik aramalar (zeytin, kredi, osimhen): aramayı açıklayan bir haber varsa konu olur, yoksa gösterilmez |

- Elenen aramalar silinmez (trend_signals’ta kalır). `pnpm trends:filter` son listedeki her aramanın kararını gösterir.
- Filtreden önce açılmış konular gizlenir (`reasons` alanında “Filtre: …” işaretiyle). Filtre değişirse ya da tek kelimelik arama haberle açıklanırsa konu yeniden açılır; elle gizlenen konular açılmaz.
- Elenen aramalar için haber araması yapılmaz.
- Liste 10. aşamada admin panelinden düzenlenebilir hâle gelecek.

### Kullanılabilirlik: mini grafik, kendiliğinden güncelleme, paylaşım

- **Mini grafik:** Kartta son 24 saatin skor eğrisi (her saatin son ölçümü; `TopicSummary.sparkline`). En az 2 ölçüm yoksa çizilmez. Dikey eksen en az 20 puanı kapsar: küçük dalgalanmalar abartılmaz.
- **Kendiliğinden güncelleme:** Sayfa açıkken 2 dakikada bir aynı kökendeki `/api/ozet` (yalnızca sıra + skor imzası) kontrol edilir.
  - Yalnızca skor/sıra değiştiyse sayfa sessizce yenilenir.
  - Yeni konu girdiyse: kullanıcı sayfanın başındaysa liste kendiliğinden güncellenir; aşağı kaydırmışsa “N yeni konu listeye girdi · Göster” şeridi çıkar (okuyanın önündeki liste değişmez) ve yukarı dönünce liste kendiliğinden güncellenir.
  - Sekme arka plandayken kontrol yapılmaz. Tarayıcı backend API’ye doğrudan bağlanmaz.
- **Paylaşım:** Konu sayfasında paylaş düğmeleri (telefonda sistem menüsü, WhatsApp, X, bağlantıyı kopyala). Konu ve ana sayfa için otomatik paylaşım görseli (Open Graph, 1200×630). Yalnızca ölçülen veri: başlık, kategori, skor, yaklaşık arama sayısı.
  - `SITE_URL` (.env) paylaşım bağlantılarının tam adresidir; canlıda `https://gundemci.org`.

### Başlık eşleşmesi sıkılaştırıldı

- Çok kelimeli aramada terimin **her kelimesi** başlıkta geçmeli; sayılar birebir (“6 ekim” ≠ “1 Ekim”), kısa kelimeler aynen.
- Aramayı yalnızca **Türkçe** başlık açıklayabilir (kural tabanlı). Türkçe sayılmak için olumlu işaret gerekir: Türkçe harf, Türkçe sık kelime ya da Türkçe ek. Türkçede olmayan harf (ñ, ä, ß, é…), tek başına yabancı dili gösteren kelime (für, und, los, these…) ya da 2+ yabancı bağlaç varsa yabancıdır. Google’ın ilgili haberleri yabancı sitelerden de gelebildiği için gerekli.
- Takvim soruları (“6 ekim ne günü”, “hangi güne denk geliyor”) tarih araması olarak elenir.
- Daha önce bağlanmış uymayan ilgili haberler her güncellemede konudan çıkarılır.

### Açıklaması olmayan aramalar listelenmez (karar güncellendi)

- Önceki karar (“aşağı it”) yerine: aramayı açıklayan **en az bir Türkçe haber** yoksa trend konusu **listelenmez**; kelime sayısı fark etmez.
- Açıklama kaynakları: eşleşen RSS haber kümesi ve Google’ın ilgili haberleri (filtrelenmiş). Haber araması (GDELT) kaldırıldı. Daha önce bağlanmış uymayan haberler kontrol öncesinde temizlenir.
- Açıklaması olmayan konu “Filtre: Aramayı açıklayan haber bulunamadı” işaretiyle gizlenir; haber bulununca kendiliğinden yeniden görünür.
- “İlk 5’e girdi” olayı da sitedeki sıralamayla aynı kuralla hesaplanır.

### Liste yenileme ve sıra okları (güncellendi)

- **Yenileme:** Alttaki “yeni konu” şeridi kaldırıldı. Liste **15 dakikada bir** kendiliğinden yenilenir (sekme arka plandayken beklenir, dönünce süre dolmuşsa hemen yenilenir). Başlığın altında **“Listeyi yenile”** düğmesi ve sayfanın son yenilenme saati var.
- **Sıra okları:** Her kartta sıra numarasının altında **~1 saat öncesine göre** değişim: yeşil ▲N yükseldi, kırmızı ▼N düştü, yeşil “▲ YENİ” son 24 saatte listede yoktu, “–” değişmedi. Karşılaştırma ölçümü 2 saatten eskiyse (ör. sistem kapalıydı) ok gösterilmez (`TopicSummary.movement`).

- **Yenileme yöntemi (güncellendi):** Otomatik yenileme ve “Listeyi yenile” düğmesi sayfayı **tamamen yeniden yükler**; kaydırma konumu korunur. Sayfa içi yenileme (router.refresh) bazı durumlarda (uykudan dönen bilgisayar, kopan bağlantı) bitmiyordu. Web tarafında API yanıtları önbelleğe alınmaz (süresi dolmuş önbellek ilk istekte eski veriyi gösteriyordu); önbellek yalnızca API’de (30 sn).

### Ortak haberler (çok sitede yayımlanan haberler)

- **Amaç:** Trend aramalarından bağımsız ikinci bir liste. RSS ile taranan haber sitelerinde **aynı haberi en az 3 farklı site** yayımladıysa listelenir.
- **Nasıl:** Her taramadan sonra (gündem üretiminin son adımı, `topics-pipeline/stories.ts`) son 24 saatin RSS haberleri benzer başlıklara göre gruplanır (aynı `cluster.ts`). Yapay zekâ yok.
  - Grup ilk kez 3 farklı siteye ulaştığı taramada listeye girer (`listed_at`).
  - Sonraki taramalarda başka siteler de yayımlarsa site sayısı artar. O taramanın zamanı ve eklenen site sayısı saklanır (`last_growth_at`, `last_growth_by`). Arayüzde “12 dk önce 2 yeni kaynak eklendi” biçiminde not çıkar (üzerine gelince saat). Aynı not detay sayfasının başında ve taramalara göre yayılma çizelgesinde de görünür.
  - Aynı sitenin ikinci haberi site sayısını artırmaz.
- **Sıralama:** Yayımlayan site sayısına göre (çoktan aza); eşitlikte son değişimi daha yeni olan üstte. En fazla 15 haber. İlk haberi 24 saatten eski olan listeden çıkar.
- **Gösterilen:** Başlık (yayımlayan sitelerden birinin başlığı, sakinleştirilmiş), site sayısı, ilk haberin zamanı, büyüme notu ve her sitenin orijinal haberine bağlantı. Haber metni alınmaz.
- **Veritabanı:** `news_stories`, `news_story_items` (bir haber yalnızca bir ortak habere bağlanır), migration `0005_stories`.
- **API:** `GET /api/v1/stories?limit=` (1–15, varsayılan 15) ve `GET /api/v1/stories/:id` (detay).
- **Arayüz:** Ana sayfada trend listesiyle **yan yana** (sağ sütunun üstünde, 15 haber; dar ekranda alt alta). `/ortak-haberler` sayfası (15 haber ve kaynakları), menüde “Ortak haberler”.
- **Detay sayfası (`/ortak-haberler/[id]`):** başlığa tıklayınca açılır.
  - **İlk yayımlayan site:** sitenin bildirdiği yayın saatine göre en erken haber. Bizim RSS’te ilk gördüğümüz an da yazılır.
  - **Taramalara göre yayılma:** haberin listeye girdiği tarama (hangi sitelerle) ve sonraki her güncellemede eklenen siteler.
  - **Yayılma hızı:** 3 siteye ulaşma süresi, ilk 1 saatte ve son 1 saatte yayımlayan site sayısı, ilk siteden son siteye geçen süre. Bunlara ek olarak zamana göre toplam site sayısı grafiği (basamaklı çizgi; noktanın üzerine gelince saat ve site).
  - **Haber kaynakları:** habere bağlı tüm haberler (aynı sitenin birden çok haberi dahil), sitenin kendi başlığı ve orijinal habere bağlantı.
  - Bütün değerler ölçülen veridir; tahmin ya da özet yoktur.
- **Mevcut “Haberlerde öne çıkanlar” ile fark:** O bölüm yalnızca trend aramasıyla eşleşmeyen ve en az 4 kaynakta geçen haber konularını gösterir. Ortak haberler listesi trend olsun olmasın tüm ortak haberleri kapsar.
