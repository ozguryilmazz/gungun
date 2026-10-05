// Gündem skoru — docs/01-mimari-plan.md, bölüm A.
// Skor bir konunun ne kadar konuşulduğunu ölçer; önemini DEĞİL.

/** Bileşen ağırlıkları (toplam 1) */
export const SCORE_WEIGHTS = {
  news_visibility: 0.35,
  velocity: 0.25,
  search_interest: 0.3,
  social: 0.1,
} as const;

export type ComponentKey = keyof typeof SCORE_WEIGHTS;

export const COMPONENT_KEYS = Object.keys(SCORE_WEIGHTS) as ComponentKey[];

export const COMPONENT_LABELS: Record<ComponentKey, string> = {
  news_visibility: "Haber görünürlüğü",
  velocity: "Yükselme hızı",
  search_interest: "Arama ilgisi (Google Trends)",
  social: "Sosyal medya",
};

/** Bir bileşenin 0–1 normalize değeri; null = bu sinyal için veri yok */
export type ComponentInput = Record<ComponentKey, number | null>;

export interface ScoreComponent {
  /** Bu bileşen için gerçek veri var mı? false ise arayüzde "Veri bekleniyor". */
  available: boolean;
  /** 0–1 arası normalize değer; available=false ise null */
  normalized: number | null;
  /** Ham ölçüm (örn. farklı yayıncı sayısı); yoksa null */
  raw: number | null;
}

export type ScoreComponents = Partial<Record<ComponentKey, ScoreComponent>>;

export interface ComputedScore {
  score: number | null;
  components: ScoreComponents;
  signalsAvailable: number;
  signalsTotal: number;
}

/**
 * Yalnızca verisi olan bileşenlerin ağırlıklı ortalaması × 100.
 * Hiç sinyal yoksa skor null döner (uydurma skor üretilmez).
 */
export function computeScore(normalized: ComponentInput): ComputedScore {
  const components: ScoreComponents = {};
  let weightedSum = 0;
  let weightTotal = 0;
  let signalsAvailable = 0;

  for (const key of COMPONENT_KEYS) {
    const value = normalized[key];
    if (value === null) {
      components[key] = { available: false, normalized: null, raw: null };
      continue;
    }
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      throw new RangeError(`${key} normalize değeri 0–1 aralığında olmalı`);
    }
    components[key] = { available: true, normalized: value, raw: null };
    weightedSum += SCORE_WEIGHTS[key] * value;
    weightTotal += SCORE_WEIGHTS[key];
    signalsAvailable += 1;
  }

  return {
    score: weightTotal === 0 ? null : Math.round((100 * weightedSum) / weightTotal),
    components,
    signalsAvailable,
    signalsTotal: COMPONENT_KEYS.length,
  };
}

/** Değişim yüzdesi yalnızca iki gerçek ölçüm varsa hesaplanır. */
export function changePercent(previous: number | null, current: number | null): number | null {
  if (previous === null || current === null || previous <= 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}

export type Trend = "surging" | "rising" | "flat" | "falling" | "unknown";

export function classifyTrend(changePct: number | null): Trend {
  if (changePct === null) return "unknown";
  if (changePct >= 40) return "surging";
  if (changePct >= 10) return "rising";
  if (changePct > -10) return "flat";
  return "falling";
}

/** Değişim ölçümü penceresi (saat) */
export const CHANGE_WINDOW_HOURS = 3;

/**
 * "Yükselenler" listesine girmek için gereken en az kaynak sayısı.
 * Az kaynaktan doğan abartılı yüzdeleri (+900% gibi) eler.
 */
export const RISING_MIN_SOURCES = 3;
