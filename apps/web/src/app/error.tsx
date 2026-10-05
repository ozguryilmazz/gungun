"use client";

import styles from "./static-page.module.css";

// Kullanıcıya teknik ayrıntı GÖSTERİLMEZ; ayrıntı yalnızca sunucu loglarındadır.
export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <main id="icerik" className={`container ${styles.page} ${styles.center}`}>
      <h1 className={styles.title}>Bu veri şu anda güncellenemiyor</h1>
      <p className={styles.lead}>Lütfen birazdan tekrar deneyin.</p>
      <button
        type="button"
        onClick={reset}
        style={{
          height: 48,
          padding: "0 20px",
          borderRadius: 12,
          border: "1px solid var(--border-strong)",
          background: "var(--surface)",
          font: "inherit",
          fontWeight: 600,
          cursor: "pointer",
        }}
      >
        Tekrar dene
      </button>
    </main>
  );
}
