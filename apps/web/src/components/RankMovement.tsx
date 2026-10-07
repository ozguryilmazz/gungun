import type { TopicSummary } from "@gundemci/shared";
import styles from "./RankMovement.module.css";

/** ~1 saat öncesine göre sıra değişimi: yeşil ▲ yükseldi / yeni, kırmızı ▼ düştü, — aynı */
export function RankMovement({ movement }: { movement: TopicSummary["movement"] }) {
  if (!movement) return null;
  const { kind, by } = movement;
  const label =
    kind === "new"
      ? "Son 1 saatte listeye yeni girdi"
      : kind === "up"
        ? `1 saat öncesine göre ${by} sıra yükseldi`
        : kind === "down"
          ? `1 saat öncesine göre ${by} sıra düştü`
          : "1 saat öncesine göre sırası değişmedi";
  return (
    <span className={`${styles.move} ${styles[kind]}`} title={label}>
      <span aria-hidden="true">
        {kind === "new" ? "▲ YENİ" : kind === "up" ? `▲${by}` : kind === "down" ? `▼${by}` : "–"}
      </span>
      <span className="visually-hidden">{label}</span>
    </span>
  );
}
