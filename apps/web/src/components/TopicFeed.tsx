import type {
  NewsStoryListResponse,
  StatusResponse,
  TopicListResponse,
  YoutubeListResponse,
} from "@gundemci/shared";
import { CHANGE_WINDOW_HOURS } from "@gundemci/shared";
import Link from "next/link";
import { formatClock, formatDate, formatRelative } from "@/lib/format";
import { CategoryNav } from "./CategoryNav";
import { ListRefresh } from "./ListRefresh";
import { MockBanner } from "./MockBanner";
import { MovementList } from "./MovementList";
import { NewsHighlights } from "./NewsHighlights";
import { NewsStories } from "./NewsStories";
import { SourceStatus } from "./SourceStatus";
import { TopicCard } from "./TopicCard";
import styles from "./TopicFeed.module.css";
import { YoutubeTrends } from "./YoutubeTrends";

interface Props {
  heading: string;
  activeCategory: string | null;
  list: TopicListResponse;
  /** null: bu bölümün verisi şu anda alınamıyor (sayfanın geri kalanı çalışır) */
  rising: TopicListResponse | null;
  falling: TopicListResponse | null;
  status: StatusResponse | null;
  news: TopicListResponse | null;
  /** Verilmezse bölüm gösterilmez (ör. kategori sayfaları) */
  youtube?: YoutubeListResponse | null;
  /** Ortak haberler (en az 3 sitede); verilmezse bölüm gösterilmez */
  stories?: NewsStoryListResponse | null;
}

/** Ana sayfa ve kategori sayfalarının ortak düzeni */
export function TopicFeed({
  heading,
  activeCategory,
  list,
  rising,
  falling,
  status,
  news,
  youtube,
  stories,
}: Props) {
  const now = new Date(list.meta.generatedAt);
  const isMock = list.meta.isMock || !!rising?.meta.isMock || !!falling?.meta.isMock;
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
              {latest ? ` · Veriler ${formatRelative(latest, now)} güncellendi` : ""} ·{" "}
              {list.items.length} konu
            </p>
            <ListRefresh refreshedAt={formatClock(list.meta.generatedAt)} />
            <p className={styles.note}>
              Liste, Türkiye’de Google’da trend olan aramalardan oluşur; haberler aramanın nedenini
              açıklar. Gündem skoru ne kadar arandığını ölçer, önemini değil.{" "}
              <Link href="/skor-nasil-hesaplanir">Skor nasıl hesaplanır?</Link>
            </p>
          </div>

          <CategoryNav active={activeCategory} />

          {list.items.length === 0 ? (
            <p className={styles.empty}>
              {activeCategory
                ? "Bu kategoride şu anda trend olan bir arama yok."
                : "Şu anda trend arama verisi yok. Bu veri şu anda güncellenemiyor olabilir."}
            </p>
          ) : (
            <ol className={styles.list}>
              {list.items.map((t) => (
                <li key={t.slug}>
                  <TopicCard topic={t} now={now} />
                </li>
              ))}
            </ol>
          )}

          {stories !== undefined ? <NewsStories data={stories} compact /> : null}

          {youtube !== undefined ? <YoutubeTrends data={youtube} compact /> : null}

          <NewsHighlights list={news} />
        </main>

        <aside className={styles.aside} aria-label="Gündem hareketleri">
          <div id="yukselenler" className={styles.anchor}>
            <MovementList
              id="rising-title"
              title="Şu anda yükselenler"
              description={`Arama ilgisinde son ${CHANGE_WINDOW_HOURS} saatteki değişim`}
              items={rising?.items ?? null}
              emptyText="Şu anda belirgin şekilde yükselen bir konu yok."
              numbered
            />
          </div>
          <MovementList
            id="falling-title"
            title="Gündemden düşenler"
            description={`Son ${CHANGE_WINDOW_HOURS} saatteki değişim`}
            items={falling?.items ?? null}
            emptyText="Şu anda belirgin şekilde düşen bir konu yok."
          />
          <SourceStatus status={status} />
        </aside>
      </div>
    </>
  );
}
