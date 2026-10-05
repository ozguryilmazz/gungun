"use client";

import { useEffect, useState } from "react";
import styles from "./ShareButtons.module.css";

interface Props {
  /** Sayfanın kendi yolu ("/gundem/ornek"); tam adres tarayıcıda kurulur */
  path: string;
  /** Paylaşım metni (tarafsız: yalnızca konu başlığı) */
  text: string;
}

/** Paylaş: telefonda sistem menüsü; ayrıca WhatsApp, X ve bağlantıyı kopyala */
export function ShareButtons({ path, text }: Props) {
  const [url, setUrl] = useState<string | null>(null);
  const [canNativeShare, setCanNativeShare] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setUrl(new URL(path, window.location.origin).toString());
    setCanNativeShare(typeof navigator.share === "function");
  }, [path]);

  if (!url) return null;

  const enc = encodeURIComponent;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Pano izni yoksa sessizce geç
    }
  };

  return (
    <div className={styles.row} aria-label="Paylaş">
      {canNativeShare ? (
        <button
          type="button"
          className={`${styles.btn} ${styles.primary}`}
          onClick={() => void navigator.share({ title: text, text, url }).catch(() => {})}
        >
          Paylaş
        </button>
      ) : null}
      <a
        className={styles.btn}
        href={`https://wa.me/?text=${enc(`${text} ${url}`)}`}
        target="_blank"
        rel="noopener noreferrer"
      >
        WhatsApp
      </a>
      <a
        className={styles.btn}
        href={`https://x.com/intent/post?text=${enc(text)}&url=${enc(url)}`}
        target="_blank"
        rel="noopener noreferrer"
      >
        X
      </a>
      <button type="button" className={styles.btn} onClick={() => void copy()}>
        {copied ? "Kopyalandı ✓" : "Bağlantıyı kopyala"}
      </button>
      <span className="visually-hidden" role="status" aria-live="polite">
        {copied ? "Bağlantı kopyalandı" : ""}
      </span>
    </div>
  );
}
