import type { Metadata } from "next";
import Link from "next/link";
import { getArchiveIndex } from "@/lib/data";
import { formatIsoDay } from "@/lib/format";
import styles from "../static-page.module.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Gündem arşivi",
  description: "Türkiye’nin günlük internet gündemi arşivi.",
};

export default async function ArchiveIndexPage() {
  const { days } = await getArchiveIndex();
  return (
    <main id="icerik" className={`container ${styles.page}`}>
      <h1 className={styles.title}>Gündem arşivi</h1>
      <p className={styles.lead}>
        Her gün en çok konuşulan konular, o günkü en yüksek gündem skoruyla saklanır.
      </p>
      {days.length === 0 ? (
        <p>Arşivde henüz gün yok.</p>
      ) : (
        <ul className={styles.list}>
          {days.map((d) => (
            <li key={d.date}>
              <span className={styles.rowHead}>
                <Link href={`/arsiv/${d.date}`}>{formatIsoDay(d.date)}</Link>
                <span className="mono">{d.topicCount} konu</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
