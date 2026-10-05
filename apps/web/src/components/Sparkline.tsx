import { SPARK_H, SPARK_W, sparklinePoints } from "@/lib/sparkline";
import styles from "./Sparkline.module.css";

/** Son 24 saatin skor eğrisi. En az 2 ölçüm yoksa hiçbir şey çizilmez (uydurma eğri yok). */
export function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const first = values[0]!;
  const last = values[values.length - 1]!;
  const direction = last > first ? "yükseldi" : last < first ? "düştü" : "değişmedi";
  return (
    <svg
      className={styles.spark}
      viewBox={`0 0 ${SPARK_W} ${SPARK_H}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={`Son ${values.length} saatte skor ${first}’den ${last}’e ${direction}`}
    >
      <polyline points={sparklinePoints(values)} />
    </svg>
  );
}
