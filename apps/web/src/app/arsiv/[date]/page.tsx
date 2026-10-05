import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { MockBanner } from "@/components/MockBanner";
import { getArchiveDay } from "@/lib/data";
import { formatIsoDay, istanbulToday } from "@/lib/format";
import styles from "../../static-page.module.css";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ date: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { date } = await params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return {};
  return {
    title: `${formatIsoDay(date)} Türkiye gündemi`,
    description: `${formatIsoDay(date)} tarihinde Türkiye’de internette en çok konuşulan konular.`,
  };
}

export default async function ArchiveDayPage({ params }: Props) {
  const { date } = await params;
  const day = await getArchiveDay(date);
  if (!day) notFound();
  const isToday = day.date === istanbulToday();

  return (
    <>
      <MockBanner show={day.meta.isMock} />
      <main id="icerik" className={`container ${styles.page}`}>
        <nav aria-label="Konum" style={{ fontSize: 13 }}>
          <Link href="/arsiv">Arşiv</Link> › {formatIsoDay(day.date)}
        </nav>
        <h1 className={styles.title}>{formatIsoDay(day.date)} Türkiye gündemi</h1>
        <p className={styles.lead}>
          O gün en çok konuşulan konular, gün içindeki en yüksek gündem skoruna göre sıralıdır.
          {isToday ? " Gün henüz bitmediği için liste güncellenmeye devam ediyor." : ""}
        </p>
        {day.items.length === 0 ? (
          <p>Bu gün için arşivlenmiş konu yok.</p>
        ) : (
          <ol className={styles.list}>
            {day.items.map((t) => (
              <li key={t.slug}>
                <span className={styles.rowHead}>
                  <Link href={`/gundem/${t.slug}`}>
                    {t.rank}. {t.title}
                  </Link>
                  <span className="mono">{t.peakScore ?? "–"}</span>
                </span>
                <span style={{ fontSize: 13, color: "var(--muted)" }}>
                  {t.category.name} · {t.sourceCount} kaynak
                </span>
              </li>
            ))}
          </ol>
        )}
      </main>
    </>
  );
}
