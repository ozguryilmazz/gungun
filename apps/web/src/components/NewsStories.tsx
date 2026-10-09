import Link from "next/link";
import type { NewsStoryListResponse } from "@gundemci/shared";
import { formatClock, formatGrowth, formatRelative } from "@/lib/format";
import styles from "./NewsStories.module.css";

interface Props {
  /** null: veri şu anda alınamıyor */
  data: NewsStoryListResponse | null;
  /** true: ana sayfa bölümü (kaynak bağlantıları gösterilmez; ayrıntı başlığa tıklayınca) */
  compact?: boolean;
  headingLevel?: "h1" | "h2";
}

/**
 * Ortak haberler: aynı haberi en az 3 farklı haber sitesi yayımladıysa listelenir; site sayısına
 * göre sıralanır. Başlık, yayımlayan sitelerden birinin başlığıdır; bağlantılar orijinal habere gider.
 */
export function NewsStories({ data, compact = false, headingLevel = "h2" }: Props) {
  const Heading = headingLevel;
  const now = data ? new Date(data.meta.generatedAt) : new Date();
  return (
    <section aria-labelledby="news-stories" className={styles.box}>
      <div className={styles.head}>
        <Heading id="news-stories" className={headingLevel === "h1" ? styles.h1 : styles.title}>
          Çok sitede yayımlanan haberler
        </Heading>
        <p className={styles.description}>
          Son 24 saatte en az 3 haber sitesinin yayımladığı haberler; en çok sitede yer alan üstte.
          {data?.scannedAt
            ? ` Haber siteleri en son ${formatRelative(data.scannedAt, now)} tarandı.`
            : ""}
        </p>
      </div>
      {data === null ? (
        <p className={styles.empty}>Bu veri şu anda güncellenemiyor.</p>
      ) : data.items.length === 0 ? (
        <p className={styles.empty}>Şu anda en az 3 haber sitesinde yer alan bir haber yok.</p>
      ) : (
        <ol className={styles.list}>
          {data.items.map((s, i) => (
            <li key={s.id} className={styles.item}>
              <span className={styles.rank} aria-hidden="true">
                {i + 1}
              </span>
              <div className={styles.body}>
                <Link href={`/ortak-haberler/${s.id}`} className={styles.name}>
                  {s.title}
                </Link>
                <p className={styles.meta}>
                  <strong>{s.publisherCount} haber sitesinde</strong> · ilk haber{" "}
                  {formatRelative(s.firstItemAt, now)}
                </p>
                {s.lastGrowthAt && s.lastGrowthBy ? (
                  <p className={styles.growth}>
                    <span aria-hidden="true">▲ </span>
                    <time dateTime={s.lastGrowthAt} title={formatClock(s.lastGrowthAt)}>
                      {formatGrowth(s.lastGrowthAt, s.lastGrowthBy, now)}
                    </time>
                  </p>
                ) : (
                  <p className={styles.listed}>Listeye girdi: {formatClock(s.listedAt)}</p>
                )}
                {!compact ? (
                  <ul className={styles.sources} aria-label="Haberi yayımlayan siteler">
                    {s.sources.map((src) => (
                      <li key={src.url}>
                        <a href={src.url} target="_blank" rel="noopener noreferrer nofollow">
                          {src.name}
                        </a>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            </li>
          ))}
        </ol>
      )}
      {compact && data && data.items.length > 0 ? (
        <Link href="/ortak-haberler" className={styles.more}>
          Kaynaklarıyla birlikte tüm liste →
        </Link>
      ) : null}
    </section>
  );
}
