import Link from "next/link";
import { Logo } from "./Logo";
import styles from "./SiteHeader.module.css";

export function SiteHeader() {
  return (
    <header className={styles.header}>
      <div className={`container ${styles.inner}`}>
        <Link href="/" className={styles.home} aria-label="gündemci ana sayfa">
          <Logo />
        </Link>
        <nav aria-label="Ana menü" className={styles.nav}>
          <Link href="/">Gündem</Link>
          <Link href="/#yukselenler">Yükselenler</Link>
          <Link href="/youtube">YouTube</Link>
          <Link href="/arsiv">Arşiv</Link>
          <Link href="/skor-nasil-hesaplanir">Skor nedir?</Link>
        </nav>
      </div>
    </header>
  );
}
