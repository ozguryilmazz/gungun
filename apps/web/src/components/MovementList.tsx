import Link from "next/link";
import type { TopicSummary } from "@gundemci/shared";
import { TrendBadge } from "./TrendBadge";
import styles from "./MovementList.module.css";

interface Props {
  id: string;
  title: string;
  description: string;
  /** null: veri şu anda alınamıyor */
  items: TopicSummary[] | null;
  emptyText: string;
  numbered?: boolean;
}

/** "Şu anda yükselenler" ve "Gündemden düşenler" listeleri */
export function MovementList({
  id,
  title,
  description,
  items,
  emptyText,
  numbered = false,
}: Props) {
  return (
    <section aria-labelledby={id} className={styles.box}>
      <div className={styles.head}>
        <h2 id={id} className={styles.title}>
          {title}
        </h2>
        <p className={styles.description}>{description}</p>
      </div>
      {items === null ? (
        <p className={styles.empty}>Bu veri şu anda güncellenemiyor.</p>
      ) : items.length === 0 ? (
        <p className={styles.empty}>{emptyText}</p>
      ) : (
        <ol className={styles.list}>
          {items.map((t, i) => (
            <li key={t.slug}>
              <Link href={`/gundem/${t.slug}`} className={styles.row}>
                {numbered ? <span className={`${styles.n} mono`}>{i + 1}</span> : null}
                <span className={styles.name}>{t.title}</span>
                <TrendBadge trend={t.trend} changePct={t.changePct} variant="short" />
              </Link>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
