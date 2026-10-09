import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SpreadChart } from "@/components/SpreadChart";
import { getStory } from "@/lib/data";
import { formatClock, formatGrowth } from "@/lib/format";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const data = await getStory((await params).id);
  if (!data) return {};
  const description = `${data.story.publisherCount} haber sitesinde yayımlandı: ilk yayımlayan site, yayılma hızı ve kaynaklar.`;
  return { title: data.story.title, description };
}

/** "45 dk", "2 sa 10 dk" */
function duration(minutes: number): string {
  if (minutes < 60) return `${minutes} dk`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} sa ${m} dk` : `${h} sa`;
}

export default async function StoryPage({ params }: Props) {
  const data = await getStory((await params).id);
  if (!data) notFound();
  const { story, sites, scans, spread, items, meta } = data;
  const now = new Date(meta.generatedAt);
  const first = sites[0];
  const isOld = now.getTime() - new Date(story.firstItemAt).getTime() > 24 * 3_600_000;

  return (
    <main id="icerik" className={`container ${styles.page}`}>
      <nav aria-label="Konum" className={styles.breadcrumb}>
        <ol>
          <li>
            <Link href="/">Gündem</Link>
          </li>
          <li>
            <Link href="/ortak-haberler">Ortak haberler</Link>
          </li>
          <li aria-current="page">Haber ayrıntısı</li>
        </ol>
      </nav>

      {isOld ? (
        <p className={styles.note} role="note">
          Bu haberin ilk yayını 24 saatten eski; artık listede değil.
        </p>
      ) : null}

      <header className={styles.header}>
        <p className={styles.eyebrow}>Çok sitede yayımlanan haber</p>
        <h1 className={styles.title}>{story.title}</h1>
        <p className={styles.dates}>
          {story.publisherCount} haber sitesinde · listeye girdi {formatClock(story.listedAt)}
        </p>
        {story.lastGrowthAt && story.lastGrowthBy ? (
          <p className={styles.growth}>
            <span aria-hidden="true">▲ </span>
            <time dateTime={story.lastGrowthAt} title={formatClock(story.lastGrowthAt)}>
              {formatGrowth(story.lastGrowthAt, story.lastGrowthBy, now)}
            </time>
          </p>
        ) : null}
        <p className={styles.fine}>
          Başlık, haberi yayımlayan sitelerden birinin başlığıdır. Haber metni alınmaz; bağlantılar
          orijinal habere gider.
        </p>
      </header>

      <div className={styles.columns}>
        <div className={styles.primary}>
          {first ? (
            <section className={styles.box} aria-labelledby="first-title">
              <h2 id="first-title" className={styles.label}>
                İlk yayımlayan site
              </h2>
              <p className={styles.firstName}>{first.name}</p>
              <p className={styles.meta}>
                <time dateTime={first.publishedAt}>{formatClock(first.publishedAt)}</time> ·{" "}
                <a href={first.url} target="_blank" rel="noopener noreferrer nofollow">
                  {first.title}
                </a>
              </p>
              <p className={styles.fine}>
                Sitenin bildirdiği yayın saatine göre. Biz {formatClock(first.fetchedAt)}’da tespit
                ettik.
              </p>
            </section>
          ) : null}

          <section className={styles.section} aria-labelledby="spread-title">
            <h2 id="spread-title" className={styles.h2}>
              Yayılma hızı
            </h2>
            <ul className={styles.stats}>
              <li>
                <span className={styles.statValue}>
                  {spread.minutesToThreeSites === null ? "—" : duration(spread.minutesToThreeSites)}
                </span>
                <span className={styles.statLabel}>3 siteye ulaşma süresi</span>
              </li>
              <li>
                <span className={styles.statValue}>{spread.sitesInFirstHour}</span>
                <span className={styles.statLabel}>İlk 1 saatte yayımlayan site</span>
              </li>
              <li>
                <span className={styles.statValue}>{spread.sitesInLastHour}</span>
                <span className={styles.statLabel}>Son 1 saatte yayımlayan site</span>
              </li>
              <li>
                <span className={styles.statValue}>{duration(spread.spanMinutes)}</span>
                <span className={styles.statLabel}>
                  İlk siteden son siteye ({sites.length} site)
                </span>
              </li>
            </ul>
            <SpreadChart sites={sites} now={now} />
          </section>

          <section className={styles.section} aria-labelledby="scans-title">
            <h2 id="scans-title" className={styles.h2}>
              Taramalara göre yayılma
            </h2>
            <ol className={styles.timeline}>
              {scans.map((scan, i) => (
                <li key={scan.at}>
                  <time dateTime={scan.at} className="mono">
                    {formatClock(scan.at)}
                  </time>
                  <span className={styles.dot} aria-hidden="true" />
                  <span>
                    <strong>
                      {i === 0
                        ? `Listeye girdi (${scan.sites.length} site)`
                        : formatGrowth(scan.at, scan.sites.length, now)}
                    </strong>
                    <span className={styles.scanSites}>{scan.sites.join(", ")}</span>
                  </span>
                </li>
              ))}
            </ol>
          </section>
        </div>

        <div className={styles.secondary}>
          <section className={styles.box} aria-labelledby="sources-title">
            <h2 id="sources-title" className={styles.h2}>
              Haber kaynakları
            </h2>
            <p className={styles.fine}>Yayın saatine göre; her site kendi başlığıyla.</p>
            <ol className={styles.sources}>
              {items.map((item) => (
                <li key={item.url}>
                  <span className={styles.sourceHead}>
                    <span className={styles.sourceName}>{item.name}</span>
                    <time dateTime={item.publishedAt} className="mono">
                      {formatClock(item.publishedAt)}
                    </time>
                  </span>
                  <a href={item.url} target="_blank" rel="noopener noreferrer nofollow">
                    {item.title}
                  </a>
                </li>
              ))}
            </ol>
          </section>
        </div>
      </div>
    </main>
  );
}
