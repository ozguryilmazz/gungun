// Mini grafik (son 24 saat skor eğrisi) için saf hesaplama — test edilebilir.
export const SPARK_W = 120;
export const SPARK_H = 28;
/** Küçük dalgalanmalar abartılmasın diye dikey eksen en az bu kadar puanı kapsar */
const MIN_RANGE = 20;

/** Değerlerden SVG çizgi noktaları (dikey eksen veri aralığına göre, en az MIN_RANGE puan) */
export function sparklinePoints(values: number[]): string {
  let lo = Math.min(...values);
  let hi = Math.max(...values);
  if (hi - lo < MIN_RANGE) {
    const pad = (MIN_RANGE - (hi - lo)) / 2;
    lo = Math.max(0, lo - pad);
    hi = Math.min(100, Math.max(hi + pad, lo + MIN_RANGE));
  }
  const step = SPARK_W / (values.length - 1);
  return values
    .map((v, i) => {
      const x = i * step;
      const y = SPARK_H - 2 - ((v - lo) / (hi - lo)) * (SPARK_H - 4);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}
