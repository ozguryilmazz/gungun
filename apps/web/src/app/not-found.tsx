import Link from "next/link";
import styles from "./static-page.module.css";

export default function NotFound() {
  return (
    <main id="icerik" className={`container ${styles.page} ${styles.center}`}>
      <h1 className={styles.title}>Aradığınız sayfa bulunamadı</h1>
      <p className={styles.lead}>Bu konu gündemden çıkmış ya da bağlantı hatalı olabilir.</p>
      <Link href="/">Bugünün gündemine dön</Link>
    </main>
  );
}
