import type { StatusResponse } from "@gundemci/shared";
import styles from "./MovementList.module.css";

const STATE_LABELS: Record<StatusResponse["providers"][number]["state"], string> = {
  not_connected: "Henüz bağlanmadı",
  ok: "Güncel",
  stale: "Gecikmeli",
  error: "Şu anda güncellenemiyor",
};

/** Veri kaynaklarının durumu — kullanıcıya teknik hata ayrıntısı gösterilmez */
export function SourceStatus({ status }: { status: StatusResponse | null }) {
  return (
    <section aria-labelledby="sources-status-title" className={styles.box}>
      <div className={styles.head}>
        <h2 id="sources-status-title" className={styles.title}>
          Veri kaynakları
        </h2>
        <p className={styles.description}>
          Bir kaynak güncellenemediğinde diğerleri çalışmaya devam eder.
        </p>
      </div>
      {status === null ? (
        <p className={styles.empty}>Bu veri şu anda güncellenemiyor.</p>
      ) : (
        <ul className={styles.list}>
          {status.providers.map((p) => (
            <li key={p.key} className={styles.statusRow}>
              <span>{p.name}</span>
              <span className={styles.statusValue}>{STATE_LABELS[p.state]}</span>
            </li>
          ))}
          <li className={styles.statusRow}>
            <span>X (Twitter)</span>
            <span className={styles.statusValue}>Henüz bağlanmadı</span>
          </li>
        </ul>
      )}
    </section>
  );
}
