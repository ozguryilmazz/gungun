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
| **Haber RSS (12 site)**              | Açıklama: trend aramayla eşleşen haberler                                   | Resmi RSS                                                                                   | 10–15 dk                                                    | Var                            |
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

### Açıklaması olmayan aramalar ve Google Haberler araması

- **Sıralama:** Trend listesinde önce aramayı açıklayan en az bir haberi olan konular, sonra açıklaması bulunamayanlar gelir. Her grup kendi içinde skora göre sıralanır; skor değişmez. Kartta “açıklayan haber henüz bulunamadı” notu gösterilir.
- **Sağlayıcı `google_news_search`:** Güncel her trend terimi için Google Haberler’in herkese açık arama RSS’inde (`news.google.com/rss/search`, son 1 gün, Türkçe) arama yapar.
  - Yalnızca başlık, kaynak adı ve bağlantı alınır; yalnızca başlığında terim geçen, son 48 saatin haberleri. Terim başına en fazla 10 haber.
  - **robots.txt** her çalışmada denetlenir (6 saat önbellek). İzin yoksa ya da okunamazsa hiç istek atılmaz.
  - Aynı terim en fazla saatte bir aranır; istekler arasında 1 sn beklenir; 429 alınırsa o çalışma durur.
  - Veritabanı: `trend_news_links` (terim ↔ haber) ve `trend_news_searches` (son arama zamanı), migration `0004_trend_news`.
- **Pipeline:** Bulunan haberler Google’ın ilgili haberleriyle birlikte trend konusuna bağlanır; kart başlığı ve “Neden gündemde?” kaynakları bunlardan gelir.
- **Değerlendirilip reddedilenler:** pytrends ve ücretli SERP servisleri (SerpApi vb.) Google’ı kazıyıp bot korumasını aştığı için kullanılmaz. Google Trends API (alpha) şimdilik beklemede.
