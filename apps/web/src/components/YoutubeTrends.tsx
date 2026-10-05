import Link from "next/link";
import type { YoutubeListResponse } from "@gundemci/shared";
import { formatRelative } from "@/lib/format";
import styles from "./YoutubeTrends.module.css";

const viewsFormatter = new Intl.NumberFormat("tr-TR", { notation: "compact" });

interface Props {
  /** null: veri şu anda alınamıyor */
  data: YoutubeListResponse | null;
  /** true: ana sayfa bölümü (tüm listeye bağlantı gösterilir) */
  compact?: boolean;
  headingLevel?: "h1" | "h2";
}

/**
 * YouTube Türkiye trend videoları. Başlık ve kanal adı değiştirilmeden gösterilir; video sitede
 * oynatılmaz, bağlantı YouTube'a gider (YouTube API Hizmet Şartları).
 */
export function YoutubeTrends({ data, compact = false, headingLevel = "h2" }: Props) {
  const Heading = headingLevel;
  const now = data ? new Date(data.meta.generatedAt) : new Date();
  return (
    <section aria-labelledby="youtube-trends" className={styles.box}>
      <div className={styles.head}>
        <Heading id="youtube-trends" className={headingLevel === "h1" ? styles.h1 : styles.title}>
          YouTube’da Türkiye trendleri
        </Heading>
        <p className={styles.description}>
          Kaynak: YouTube (Türkiye trend videoları)
          {data?.observedAt ? ` · Son güncelleme: ${formatRelative(data.observedAt, now)}` : ""}
        </p>
      </div>
      {data === null ? (
        <p className={styles.empty}>Bu veri şu anda güncellenemiyor.</p>
      ) : data.items.length === 0 ? (
        <p className={styles.empty}>YouTube trend verisi henüz yok.</p>
      ) : (
        <ol className={styles.list}>
          {data.items.map((v) => (
            <li key={v.videoId}>
              <a
                href={v.url}
                className={styles.row}
                target="_blank"
                rel="noopener noreferrer nofollow"
              >
                <span className={styles.rank} aria-hidden="true">
                  {v.rank}
                </span>
                {v.thumbnailUrl ? (
                  // Küçük resim YouTube sunucusundan; CSP'de yalnızca i.ytimg.com izinli
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={v.thumbnailUrl}
                    alt=""
                    width={160}
                    height={90}
                    loading="lazy"
                    referrerPolicy="no-referrer"
                    className={styles.thumb}
                  />
                ) : (
                  <span className={styles.thumb} aria-hidden="true" />
                )}
                <span className={styles.text}>
                  <span className={styles.name}>{v.title}</span>
                  <span className={styles.meta}>
                    {v.channelTitle}
                    {v.viewCount !== null ? ` · ${viewsFormatter.format(v.viewCount)} izlenme` : ""}
                    {v.publishedAt ? ` · ${formatRelative(v.publishedAt, now)}` : ""}
                  </span>
                </span>
              </a>
            </li>
          ))}
        </ol>
      )}
      {compact && data && data.items.length > 0 ? (
        <Link href="/youtube" className={styles.more}>
          İlk 50 videoyu gör →
        </Link>
      ) : null}
    </section>
  );
}
