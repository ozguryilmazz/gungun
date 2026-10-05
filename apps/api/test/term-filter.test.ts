import { describe, expect, it } from "vitest";
import { classifyTerm } from "../src/topics-pipeline/term-filter.ts";

const reasonOf = (t: string) => classifyTerm(t);

describe("trend arama filtresi (gerçek Google Trends TR listesinden örnekler)", () => {
  it.each([
    ["memurlar net", "site_or_brand"],
    ["memurlar", "site_or_brand"],
    ["mynet", "site_or_brand"],
    ["milliyet", "site_or_brand"],
    ["sözcü gazetesi", "site_or_brand"],
    ["haber7", "site_or_brand"],
    ["en son haber", "site_or_brand"],
    ["gazete oku", "site_or_brand"],
    ["trendyol", "site_or_brand"],
    ["transfermarkt", "site_or_brand"],
    ["trt 1", "site_or_brand"],
    ["trt spor", "site_or_brand"],
    ["halk tv", "site_or_brand"],
    ["son dakika haberi", "site_or_brand"],
    ["tv100 canlı", "live_stream"],
    ["kanald canli izle", "live_stream"],
    ["show tv canlı", "live_stream"],
    ["müge anlı canlı", "live_stream"],
    ["a spor canlı", "live_stream"],
    ["gaziantep hava durumu", "routine_service"],
    ["şanlıurfa hava durumu", "routine_service"],
    ["wetter", "routine_service"],
    ["imsak", "routine_service"],
    ["yatsı namazı", "routine_service"],
    ["gram altın fiyatları", "routine_service"],
    ["çeyrek altın fiyatı", "routine_service"],
    ["mevduat faiz oranları", "routine_service"],
    ["çarşamba günü hangi diziler var", "routine_service"],
    ["spotify çöktü mü", "routine_service"],
    ["betplay", "illegal"],
    ["iptv", "illegal"],
    ["البرتغال ضد النرويج", "foreign_language"],
    ["погода", "foreign_language"],
    ["آبوهوا", "foreign_language"],
    ["portugal vs norway", "foreign_language"],
    ["türkei – italien", "foreign_language"],
    ["flights", "foreign_language"],
    ["2026", "date_or_weekday"],
    ["pazartesi", "date_or_weekday"],
    ["3 ekim", "date_or_weekday"],
    ["28 eylül", "date_or_weekday"],
  ])("elenir: %s (%s)", (term, reason) => {
    expect(reasonOf(term)).toEqual({ verdict: "exclude", reason });
  });

  it.each(["zeytin", "kredi", "istanbul", "osimhen", "aöf", "enflasyon", "hakem"])(
    "tek kelime yalnızca haberle açıklanırsa: %s",
    (term) => expect(reasonOf(term)).toEqual({ verdict: "needs_news", reason: "single_word" }),
  );

  it.each([
    "özgür özel",
    "göksel arsoy",
    "belçika - türkiye",
    "adana deprem",
    "reyhanlı saldırısı",
    "motorine indirim",
    "üç meslek grubuna yeşil pasaport",
    "togg ekim kampanyası",
    "masterchef kim elendi",
    "tuzlu kahve 5. bölüm",
    "2026 birleşmiş milletler iklim değişikliği konferansı",
    "kpss önlisans",
    "bilirkişilik başvuru sonuçları",
  ])("gündem konusu olur: %s", (term) => {
    expect(reasonOf(term)).toEqual({ verdict: "keep", reason: null });
  });
});
