"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useTransition } from "react";
import styles from "./ListRefresh.module.css";

/** Liste bu aralıkla kendiliğinden yenilenir */
export const AUTO_REFRESH_MS = 15 * 60_000;

interface Props {
  /** Son yenileme saati (sunucuda biçimlenmiş, ör. "14:05") */
  refreshedAt: string;
}

/**
 * "Listeyi yenile" düğmesi + 15 dakikada bir kendiliğinden yenileme.
 * Sekme arka plandayken yenilenmez; sekmeye dönüldüğünde süre dolmuşsa hemen yenilenir.
 * Yenileme sunucudan yeni listeyi alır; kaydırma konumu korunur.
 */
export function ListRefresh({ refreshedAt }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const last = useRef(Date.now());

  const refresh = () => {
    last.current = Date.now();
    startTransition(() => router.refresh());
  };
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  useEffect(() => {
    const due = () => Date.now() - last.current >= AUTO_REFRESH_MS;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible" && due()) refreshRef.current();
    }, 30_000);
    const onVisible = () => {
      if (document.visibilityState === "visible" && due()) refreshRef.current();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  return (
    <span className={styles.wrap}>
      <button
        type="button"
        className={styles.btn}
        onClick={refresh}
        disabled={pending}
        aria-label="Listeyi şimdi yenile"
      >
        <span aria-hidden="true" className={pending ? styles.spin : styles.icon}>
          ↻
        </span>
        {pending ? "Yenileniyor…" : "Listeyi yenile"}
      </button>
      <span className={styles.note} role="status" aria-live="polite">
        Sayfa yenilendi: {refreshedAt} · 15 dakikada bir kendiliğinden yenilenir
      </span>
    </span>
  );
}
