import Link from "next/link";
import type { TopicSummary } from "@gundemci/shared";
import { formatRelative } from "@/lib/format";
import { ScoreBar } from "./ScoreBar";
import { TrendBadge } from "./TrendBadge";
import styles from "./TopicCard.module.css";

export function TopicCard({ topic, now }: { topic: TopicSummary; now: Date }) {
  return (
    <Link href={`/gundem/${topic.slug}`} className={styles.card}>
      <span className={`${styles.rank} mono`}>
        <span className="visually-hidden">Sıra </span>
        {topic.rank ?? "–"}
      </span>
      <span className={styles.category}>{topic.category.name}</span>
      <span className={styles.score}>
        {topic.score === null ? (
          <span className={styles.noScore}>Skor yok</span>
        ) : (
          <span className="mono">
            <span className="visually-hidden">Gündem skoru </span>
            {topic.score}
            <span className={styles.outOf}>/100</span>
          </span>
        )}
      </span>
      <span className={styles.title}>{topic.title}</span>
      <span className={styles.bar}>
        <ScoreBar value={topic.score} />
      </span>
      <span className={styles.trend}>
        <TrendBadge trend={topic.trend} changePct={topic.changePct} />
      </span>
      {topic.summary ? <span className={styles.summary}>{topic.summary}</span> : null}
      <span className={styles.meta}>
        <span>{topic.sourceCount} kaynak</span>
        <span aria-hidden="true">·</span>
        <span>
          {topic.signalsAvailable}/{topic.signalsTotal} sinyal
        </span>
        <span aria-hidden="true">·</span>
        <span>{formatRelative(topic.updatedAt, now)}</span>
      </span>
    </Link>
  );
}
