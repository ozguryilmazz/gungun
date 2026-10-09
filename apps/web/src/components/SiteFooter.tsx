import Link from "next/link";
import { Logo } from "./Logo";
import styles from "./SiteFooter.module.css";

export function SiteFooter() {
  return (
    <footer className={styles.footer}>
      <div className={`container ${styles.inner}`}>
        <Logo size="sm" />
        <p className={styles.note}>
          gündemci haber üretmez; kaynakları analiz eder ve orijinal habere bağlantı verir.
        </p>
        <p className={styles.note}>
          Veri kaynakları: Google Trends, YouTube ve haber sitelerinin RSS akışları.
        </p>
        <nav aria-label="Alt menü" className={styles.links}>
          <Link href="/arsiv">Arşiv</Link>
          <Link href="/skor-nasil-hesaplanir">Skor nasıl hesaplanır?</Link>
        </nav>
      </div>
    </footer>
  );
}
