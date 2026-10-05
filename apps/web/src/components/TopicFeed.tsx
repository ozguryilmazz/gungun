import type { TopicListResponse } from "@gundemci/shared";
import { CHANGE_WINDOW_HOURS, RISING_MIN_SOURCES } from "@gundemci/shared";
import Link from "next/link";
import { formatDate, formatRelative } from "@/lib/format";
import { CategoryNav } from "./CategoryNav";
import { MockBanner } from "./MockBanner";
import { MovementList } from "./MovementList";
import { TopicCard } from "./TopicCard";
import styles from "./TopicFeed.module.css";

interface Props {
  heading: string;
  activeCategory: string | null;
  list: TopicListResponse;
  rising: TopicListResponse;
  falling: TopicListResponse;
}

/** Ana sayfa ve kategori sayfalarının ortak düzeni */
export function TopicFeed({ heading, activeCategory, list, rising, falling }: Props) {
  const now = new Date(list.meta.generatedAt);
  const isMock = list.meta.isMock || rising.meta.isMock || falling.meta.isMock;
  const latest = list.items.reduce<string | null>(
    (acc, t) => (acc === null || t.updatedAt > acc ? t.updatedAt : acc),
    null,
  );

  return (
    <>
      <MockBanner show={isMock} />
      <div className={`container ${styles.layout}`}>
        <main id="icerik" className={styles.main}>
          <div className={styles.intro}>
            <h1 className={styles.heading}>{heading}</h1>
            <p className={styles.sub}>
              {formatDate(now)}
              {latest ? ` · Son güncelleme: ${formatRelative(latest, now)}` : ""} ·{" "}
              {list.items.length} konu
            </p>
            <p className={styles.note}>
              Gündem skoru bir konunun ne kadar konuşulduğunu ölçer, önemini değil.{" "}
              <Link href="/skor-nasil-hesaplanir">Skor nasıl hesaplanır?</Link>
            </p>
          </div>

          <CategoryNav active={activeCategory} />

          {list.items.length === 0 ? (
            <p className={styles.empty}>Bu kategoride şu anda gündemde olan bir konu yok.</p>
          ) : (
            <ol className={styles.list}>
              {list.items.map((t) => (
                <li key={t.slug}>
                  <TopicCard topic={t} now={now} />
                </li>
              ))}
            </ol>
          )}
        </main>

        <aside className={styles.aside} aria-label="Gündem hareketleri">
          <div id="yukselenler" className={styles.anchor}>
            <MovementList
              id="rising-title"
              title="Şu anda yükselenler"
              description={`Son ${CHANGE_WINDOW_HOURS} saatteki değişim · en az ${RISING_MIN_SOURCES} kaynakta yer alan konular`}
              items={rising.items}
              emptyText="Şu anda belirgin şekilde yükselen bir konu yok."
              numbered
            />
          </div>
          <MovementList
            id="falling-title"
            title="Gündemden düşenler"
            description={`Son ${CHANGE_WINDOW_HOURS} saatteki değişim`}
            items={falling.items}
            emptyText="Şu anda belirgin şekilde düşen bir konu yok."
          />
        </aside>
      </div>
    </>
  );
}
