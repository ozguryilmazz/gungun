import styles from "./MockBanner.module.css";

/** Örnek veri gösterilirken her sayfada görünür; gerçek veri varmış gibi davranılmaz. */
export function MockBanner({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <div className={styles.banner} role="note">
      <p className="container">
        <strong>ÖRNEK VERİ</strong> — Bu sayfadaki konular gerçek değildir, tasarım ve geliştirme
        için oluşturulmuştur.
      </p>
    </div>
  );
}
