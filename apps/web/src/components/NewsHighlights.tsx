import Link from "next/link";
import type { TopicListResponse } from "@gundemci/shared";
import styles from "./NewsHighlights.module.css";

/** Aramada trend olmayan ama çok kaynakta geçen haberler — ana listeden ayrı */
export function NewsHighlights({ list }: { list: TopicListResponse | null }) {
  return (
    <section aria-labelledby="news-highlights" className={styles.box}>
      <div className={styles.head}>
        <h2 id="news-highlights" className={styles.title}>
          Haberlerde öne çıkanlar
        </h2>
        <p className={styles.description}>
          Google’da trend olmayan ama birçok haber kaynağının yazdığı konular
        </p>
      </div>
      {list === null ? (
        <p className={styles.empty}>Bu veri şu anda güncellenemiyor.</p>
      ) : list.items.length === 0 ? (
        <p className={styles.empty}>Şu anda öne çıkan başka bir haber yok.</p>
      ) : (
        <ul className={styles.list}>
          {list.items.map((t) => (
            <li key={t.slug}>
              <Link href={`/gundem/${t.slug}`} className={styles.row}>
                <span className={styles.name}>{t.title}</span>
                <span className={styles.meta}>
                  {t.category.name} · {t.sourceCount} kaynak
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
