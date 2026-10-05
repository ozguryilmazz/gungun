import styles from "./ScoreBar.module.css";

/** 0–100 değer çubuğu; değer yoksa kesik çizgili boş çubuk ("veri bekleniyor") */
export function ScoreBar({ value, thick = false }: { value: number | null; thick?: boolean }) {
  if (value === null) {
    return <span className={`${styles.track} ${styles.empty}`} aria-hidden="true" />;
  }
  const width = Math.min(Math.max(value, 0), 100);
  return (
    <span className={`${styles.track} ${thick ? styles.thick : ""}`} aria-hidden="true">
      <span className={styles.fill} style={{ width: `${width}%` }} />
    </span>
  );
}
