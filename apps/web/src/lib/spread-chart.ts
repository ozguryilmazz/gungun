// Ortak haberin yayılma grafiği (zamana göre toplam site sayısı) için saf hesaplama — test edilebilir.
export const CHART_W = 640;
export const CHART_H = 200;
export const PAD = { top: 16, right: 8, bottom: 4, left: 32 };
/** Çok kısa sürede yayılan haberde grafik ezilmesin diye yatay eksen en az bu kadar sürer */
const MIN_SPAN_MS = 30 * 60_000;

export interface SpreadPoint {
  /** Ekran koordinatları */
  x: number;
  y: number;
  /** O ana kadar yayımlayan site sayısı */
  count: number;
  at: string;
  name: string;
}

export interface SpreadChart {
  points: SpreadPoint[];
  /** Basamak çizgisi (site sayısı yalnızca yeni site yayımlayınca artar) */
  path: string;
  yTicks: { y: number; value: number }[];
  xTicks: { x: number; at: string }[];
  baseline: number;
}

const plotW = CHART_W - PAD.left - PAD.right;
const plotH = CHART_H - PAD.top - PAD.bottom;

/** Sitelerin ilk yayın zamanlarından (eskiden yeniye) basamaklı toplam site sayısı grafiği */
export function spreadChart(
  sites: { name: string; publishedAt: string }[],
  now: Date,
): SpreadChart | null {
  if (sites.length < 2) return null;
  const times = sites.map((s) => new Date(s.publishedAt).getTime());
  const start = times[0]!;
  // Grafik şimdiye kadar uzar: son siteden sonra yayılma durduysa düz çizgi bunu gösterir
  const end = Math.max(now.getTime(), times[times.length - 1]!, start + MIN_SPAN_MS);
  const max = sites.length;
  const x = (t: number) => PAD.left + ((t - start) / (end - start)) * plotW;
  const y = (n: number) => PAD.top + plotH - (n / max) * plotH;

  const points = sites.map((s, i) => ({
    x: round(x(times[i]!)),
    y: round(y(i + 1)),
    count: i + 1,
    at: s.publishedAt,
    name: s.name,
  }));
  let path = `M${points[0]!.x},${points[0]!.y}`;
  for (const p of points.slice(1)) path += ` H${p.x} V${p.y}`;
  path += ` H${round(x(end))}`;

  const half = Math.round(max / 2);
  const yValues = [...new Set([0, half > 0 && half < max ? half : null, max])].filter(
    (v): v is number => v !== null,
  );
  return {
    points,
    path,
    yTicks: yValues.map((value) => ({ y: round(y(value)), value })),
    xTicks: [
      { x: round(x(start)), at: new Date(start).toISOString() },
      { x: round(x(end)), at: new Date(end).toISOString() },
    ],
    baseline: round(y(0)),
  };
}

const round = (n: number) => Math.round(n * 10) / 10;
