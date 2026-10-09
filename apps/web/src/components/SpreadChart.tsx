import { formatClock } from "@/lib/format";
import { CHART_H, CHART_W, PAD, spreadChart } from "@/lib/spread-chart";
import styles from "./SpreadChart.module.css";

interface Props {
  sites: { name: string; publishedAt: string }[];
  now: Date;
}

/** SVG koordinatını kapsayıcıya göre yüzdeye çevirir (yazılar HTML'dir; küçük ekranda küçülmez) */
const left = (x: number) => `${(x / CHART_W) * 100}%`;
const top = (y: number) => `${(y / CHART_H) * 100}%`;

/**
 * Yayılma grafiği: zamana göre haberi yayımlayan toplam site sayısı (sitenin bildirdiği yayın
 * saatine göre). Noktanın üzerine gelince saat ve site adı görünür; aynı veri aşağıdaki
 * zaman çizelgesinde ve kaynak listesinde metin olarak da vardır.
 */
export function SpreadChart({ sites, now }: Props) {
  const chart = spreadChart(sites, now);
  if (!chart) return null;
  const last = chart.points[chart.points.length - 1]!;
  const labelAtEnd = last.x > CHART_W - 90;
  return (
    <figure className={styles.figure}>
      <div className={styles.plot}>
        <svg
          viewBox={`0 0 ${CHART_W} ${CHART_H}`}
          className={styles.svg}
          role="img"
          aria-label={`${formatClock(chart.points[0]!.at)} ile ${formatClock(last.at)} arasında ${last.count} haber sitesine yayıldı`}
        >
          {chart.yTicks.map((t) => (
            <line
              key={t.value}
              x1={PAD.left}
              x2={CHART_W - PAD.right}
              y1={t.y}
              y2={t.y}
              className={t.value === 0 ? styles.baseline : styles.grid}
            />
          ))}
          <path d={chart.path} className={styles.line} />
          {chart.points.map((p) => (
            <g key={`${p.name}-${p.at}`} className={styles.point}>
              {/* Geniş, görünmez dokunma alanı */}
              <circle cx={p.x} cy={p.y} r={14} className={styles.hit} />
              <circle cx={p.x} cy={p.y} r={5} className={styles.dot} />
              <title>{`${formatClock(p.at)} · ${p.name} · ${p.count}. site`}</title>
            </g>
          ))}
        </svg>
        {chart.yTicks.map((t) => (
          <span
            key={t.value}
            className={`${styles.axis} ${styles.yLabel}`}
            style={{ top: top(t.y) }}
            aria-hidden="true"
          >
            {t.value}
          </span>
        ))}
        <span
          className={styles.label}
          style={{
            top: top(last.y),
            ...(labelAtEnd
              ? { right: `${100 - (last.x / CHART_W) * 100}%` }
              : { left: left(last.x) }),
          }}
          aria-hidden="true"
        >
          {last.count} site
        </span>
      </div>
      <div className={styles.xAxis} aria-hidden="true">
        <span className={styles.axis}>{formatClock(chart.xTicks[0]!.at)}</span>
        <span className={styles.axis}>{formatClock(chart.xTicks[1]!.at)} (şimdi)</span>
      </div>
      <figcaption className={styles.caption}>
        Zamana göre haberi yayımlayan toplam site sayısı (sitelerin bildirdiği yayın saatine göre)
      </figcaption>
    </figure>
  );
}
