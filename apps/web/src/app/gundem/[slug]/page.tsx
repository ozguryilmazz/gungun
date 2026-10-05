import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CHANGE_WINDOW_HOURS, TIMELINE_LABELS } from "@gundemci/shared";
import { MockBanner } from "@/components/MockBanner";
import { ScoreBar } from "@/components/ScoreBar";
import { TrendBadge } from "@/components/TrendBadge";
import { getTopic } from "@/lib/data";
import { formatClock, formatRelative } from "@/lib/format";
import styles from "./page.module.css";

export const revalidate = 60;

interface Props {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const result = await getTopic((await params).slug);
  if (!result) return {};
  const { item } = result;
  return {
    title: `${item.title} — Neden gündemde?`,
    description: item.summary ?? `${item.title} neden gündemde? Kaynaklar ve gündem skoru.`,
  };
}

const SUMMARY_LABELS = {
  manual: "Editör özeti",
  ai: "Otomatik özet — kaynaklara dayanır",
  none: null,
} as const;

export default async function TopicPage({ params }: Props) {
  const result = await getTopic((await params).slug);
  if (!result) notFound();
  const { item: topic, meta } = result;
  const now = new Date(meta.generatedAt);
  const summaryLabel = SUMMARY_LABELS[topic.summaryOrigin];

  return (
    <>
      <MockBanner show={meta.isMock || topic.isMock} />
      <main id="icerik" className={`container ${styles.page}`}>
        <nav aria-label="Konum" className={styles.breadcrumb}>
          <ol>
            <li>
              <Link href="/">Gündem</Link>
            </li>
            <li>
              <Link href={`/kategori/${topic.category.slug}`}>{topic.category.name}</Link>
            </li>
            <li aria-current="page">Neden gündemde?</li>
          </ol>
        </nav>

        <header className={styles.header}>
          <p className={styles.eyebrow}>Neden gündemde?</p>
          <h1 className={styles.title}>{topic.title}</h1>
          <p className={styles.dates}>
            İlk görülme {formatClock(topic.firstSeenAt)} · Son güncelleme{" "}
            {formatRelative(topic.updatedAt, now)}
          </p>
        </header>

        <div className={styles.columns}>
          <div className={styles.primary}>
            <section className={styles.box} aria-labelledby="score-title">
              <div className={styles.scoreRow}>
                <div className={styles.scoreMain}>
                  <h2 id="score-title" className={styles.label}>
                    Gündem skoru
                  </h2>
                  {topic.score === null ? (
                    <p className={styles.noScore}>Skor hesaplanamadı — sinyal verisi bekleniyor.</p>
                  ) : (
                    <p className={`${styles.bigScore} mono`}>
                      {topic.score}
                      <span className={styles.outOf}>/100</span>
                    </p>
                  )}
                </div>
                <div className={styles.scoreSide}>
                  <TrendBadge
                    trend={topic.trend}
                    changePct={topic.changePct}
                    variant="short"
                    boxed
                  />
                  <span className={styles.pill}>
                    {topic.signalsAvailable}/{topic.signalsTotal} sinyal
                    {topic.rank ? ` · ${topic.rank}. sırada` : ""}
                  </span>
                </div>
              </div>
              <ScoreBar value={topic.score} thick />
              <p className={styles.fine}>
                {topic.previousScore !== null && topic.score !== null
                  ? `${CHANGE_WINDOW_HOURS} saat önce ${topic.previousScore} → şimdi ${topic.score}. `
                  : ""}
                Skor konunun ne kadar konuşulduğunu ölçer, önemini değil.
              </p>
            </section>

            <section className={styles.section} aria-labelledby="summary-title">
              <div className={styles.sectionHead}>
                <h2 id="summary-title" className={styles.h2}>
                  Kısa özet
                </h2>
                {summaryLabel ? <span className={styles.tag}>{summaryLabel}</span> : null}
              </div>
              {topic.summary ? (
                <p className={styles.summary}>{topic.summary}</p>
              ) : (
                <p className={styles.pending}>Özet hazırlanıyor.</p>
              )}
            </section>

            {topic.reasons.length > 0 ? (
              <section className={styles.section} aria-labelledby="reasons-title">
                <h2 id="reasons-title" className={styles.h2}>
                  Neden gündemde?
                </h2>
                <ul className={styles.reasons}>
                  {topic.reasons.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
              </section>
            ) : null}

            {topic.timeline.length > 0 ? (
              <section className={styles.section} aria-labelledby="timeline-title">
                <h2 id="timeline-title" className={styles.h2}>
                  Gündem zaman çizelgesi
                </h2>
                <ol className={styles.timeline}>
                  {topic.timeline.map((e) => (
                    <li key={`${e.type}-${e.occurredAt}`}>
                      <time dateTime={e.occurredAt} className="mono">
                        {formatClock(e.occurredAt)}
                      </time>
                      <span className={styles.dot} aria-hidden="true" />
                      <span>{TIMELINE_LABELS[e.type]}</span>
                    </li>
                  ))}
                </ol>
              </section>
            ) : null}
          </div>

          <div className={styles.secondary}>
            <section className={styles.box} aria-labelledby="components-title">
              <div className={styles.sectionHead}>
                <h2 id="components-title" className={styles.h2}>
                  Skorun bileşenleri
                </h2>
                <Link href="/skor-nasil-hesaplanir" className={styles.small}>
                  Nasıl hesaplanır?
                </Link>
              </div>
              <ul className={styles.components}>
                {topic.components.map((c) => (
                  <li key={c.key}>
                    <span className={styles.componentRow}>
                      <span>{c.label}</span>
                      {c.available && c.value !== null ? (
                        <span className="mono">{c.value}</span>
                      ) : (
                        <span className={styles.waiting}>Veri bekleniyor</span>
                      )}
                    </span>
                    <ScoreBar value={c.available ? c.value : null} />
                  </li>
                ))}
              </ul>
              <p className={styles.fine}>
                Verisi olmayan sinyal skora katılmaz; skor {topic.signalsTotal} sinyalden{" "}
                {topic.signalsAvailable} tanesiyle hesaplandı.
              </p>
            </section>

            <section className={styles.section} aria-labelledby="sources-title">
              <h2 id="sources-title" className={styles.h2}>
                Kaynaklar <span className={`${styles.count} mono`}>{topic.sources.length}</span>
              </h2>
              {topic.sources.length === 0 ? (
                <p className={styles.pending}>Bu konu için henüz kaynak bulunmuyor.</p>
              ) : (
                <ul className={styles.sources}>
                  {topic.sources.map((s) => (
                    <li key={s.url}>
                      <a
                        href={s.url}
                        target="_blank"
                        rel="noopener noreferrer nofollow"
                        className={styles.source}
                      >
                        <span className={styles.sourceText}>
                          <span className={styles.publisher}>
                            {s.publisherName}
                            {s.publishedAt ? ` · ${formatClock(s.publishedAt)}` : ""}
                          </span>
                          <span className={styles.sourceTitle}>{s.title}</span>
                        </span>
                        <svg
                          width="18"
                          height="18"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          aria-hidden="true"
                        >
                          <path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1h5" />
                        </svg>
                        <span className="visually-hidden">(yeni sekmede açılır)</span>
                      </a>
                    </li>
                  ))}
                </ul>
              )}
              <p className={styles.fine}>
                Haber metinleri kopyalanmaz; yalnızca başlık, kaynak adı ve orijinal habere bağlantı
                gösterilir.
              </p>
            </section>
          </div>
        </div>
      </main>
    </>
  );
}
