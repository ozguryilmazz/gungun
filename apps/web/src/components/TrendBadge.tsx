import type { TopicSummary } from "@gundemci/shared";
import { CHANGE_WINDOW_HOURS } from "@gundemci/shared";
import { TREND_ARROWS, TREND_LABELS, formatChange } from "@/lib/format";
import styles from "./TrendBadge.module.css";

interface Props {
  trend: TopicSummary["trend"];
  changePct: number | null;
  /** "full": yüzde + etiket + pencere, "short": yalnızca ok + yüzde */
  variant?: "full" | "short";
  boxed?: boolean;
}

export function TrendBadge({ trend, changePct, variant = "full", boxed = false }: Props) {
  const tone =
    trend === "surging" || trend === "rising"
      ? styles.up
      : trend === "falling"
        ? styles.down
        : styles.flat;

  if (changePct === null) {
    return <span className={`${styles.badge} ${styles.flat}`}>{TREND_LABELS.unknown}</span>;
  }

  const value = `${TREND_ARROWS[trend]} ${formatChange(changePct)}`;

  return (
    <span
      className={`${styles.badge} ${tone} ${boxed ? styles.boxed : ""}`}
      aria-label={`Son ${CHANGE_WINDOW_HOURS} saatte ${formatChange(changePct)}, ${TREND_LABELS[trend]}`}
    >
      <span data-part="value">{value}</span>
      {variant === "full" ? (
        <span data-part="label" className={styles.label}>
          {TREND_LABELS[trend]} · {CHANGE_WINDOW_HOURS} saat
        </span>
      ) : null}
    </span>
  );
}
