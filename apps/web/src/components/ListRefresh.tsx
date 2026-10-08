"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./ListRefresh.module.css";

/** Liste bu aralıkla kendiliğinden yenilenir */
export const AUTO_REFRESH_MS = 15 * 60_000;
const SCROLL_KEY = "gundemci:scrollY";

interface Props {
  /** Son yenileme saati (sunucuda biçimlenmiş, ör. "14:05") */
  refreshedAt: string;
}

/** Sayfayı yeniden yükler; kaydırma konumu saklanır ve yükleme sonrası geri getirilir */
function reloadKeepingScroll() {
  try {
    sessionStorage.setItem(SCROLL_KEY, String(window.scrollY));
  } catch {
    // Tarayıcı depolamaya izin vermiyorsa sayfanın başından açılır
  }
  window.location.reload();
}

/**
 * "Listeyi yenile" düğmesi + 15 dakikada bir kendiliğinden yenileme.
 * Sayfa tamamen yeniden yüklenir (en güvenilir yol: takılan istek, uykudan dönen bilgisayar,
 * önbellekteki eski veri sorun olmaz); kaydırma konumu korunur.
 * Sekme arka plandayken beklenir; sekmeye dönüldüğünde süre dolmuşsa hemen yenilenir.
 */
export function ListRefresh({ refreshedAt }: Props) {
  const [busy, setBusy] = useState(false);
  const loadedAt = useRef(Date.now());

  // Yenilemeden önceki kaydırma konumuna dön
  useEffect(() => {
    try {
      const y = sessionStorage.getItem(SCROLL_KEY);
      if (y !== null) {
        sessionStorage.removeItem(SCROLL_KEY);
        window.scrollTo(0, Number(y) || 0);
      }
    } catch {
      // yoksay
    }
  }, []);

  useEffect(() => {
    const due = () => Date.now() - loadedAt.current >= AUTO_REFRESH_MS;
    const check = () => {
      if (document.visibilityState === "visible" && due()) reloadKeepingScroll();
    };
    // Süre, sekme arka plandayken ya da bilgisayar uykudayken de işler; dönüşte hemen kontrol edilir
    const timer = setInterval(check, 30_000);
    document.addEventListener("visibilitychange", check);
    window.addEventListener("focus", check);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", check);
      window.removeEventListener("focus", check);
    };
  }, []);

  return (
    <span className={styles.wrap}>
      <button
        type="button"
        className={styles.btn}
        onClick={() => {
          setBusy(true);
          reloadKeepingScroll();
        }}
        disabled={busy}
        aria-label="Listeyi şimdi yenile"
      >
        <span aria-hidden="true" className={busy ? styles.spin : styles.icon}>
          ↻
        </span>
        {busy ? "Yenileniyor…" : "Listeyi yenile"}
      </button>
      <span className={styles.note} role="status" aria-live="polite">
        Sayfa yenilendi: {refreshedAt} · 15 dakikada bir kendiliğinden yenilenir
      </span>
    </span>
  );
}
