"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { newSlugs } from "@/lib/refresh";
import styles from "./AutoRefresh.module.css";

/** Kontrol aralığı: veriler yaklaşık 10 dakikada bir değişir; 2 dakika yeterince günceldir */
const INTERVAL_MS = 120_000;

interface Props {
  slugs: string[];
  signature: string;
  category: string | null;
}

/**
 * Sayfa açıkken listeyi arka planda kontrol eder.
 * - Yalnızca skorlar/sıra değiştiyse sayfa sessizce yenilenir (kaydırma konumu korunur).
 * - Listeye YENİ konu girdiyse okuyanın önündeki liste değişmesin diye önce şerit gösterilir.
 * - Sekme arka plandayken kontrol yapılmaz.
 */
export function AutoRefresh({ slugs, signature, category }: Props) {
  const router = useRouter();
  const [pending, setPending] = useState(0);
  const latest = useRef({ slugs, signature });
  latest.current = { slugs, signature };

  // Sayfa yenilenince yeni veriyle şerit kapanır
  useEffect(() => setPending(0), [signature]);

  const check = useCallback(async () => {
    if (document.visibilityState !== "visible") return;
    try {
      const qs = category ? `?kategori=${encodeURIComponent(category)}` : "";
      const res = await fetch(`/api/ozet${qs}`, { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { slugs?: unknown; signature?: unknown };
      if (!Array.isArray(data.slugs) || typeof data.signature !== "string") return;
      const fetched = data.slugs.filter((s): s is string => typeof s === "string");
      const added = newSlugs(latest.current.slugs, fetched);
      if (added.length > 0) setPending(added.length);
      else if (data.signature !== latest.current.signature) router.refresh();
    } catch {
      // Ağ hatası: bir sonraki kontrolde tekrar denenir; kullanıcıya hata gösterilmez
    }
  }, [category, router]);

  useEffect(() => {
    const timer = setInterval(check, INTERVAL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void check();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [check]);

  return (
    <div className={styles.wrap} role="status" aria-live="polite">
      {pending > 0 ? (
        <button
          type="button"
          className={styles.pill}
          onClick={() => {
            router.refresh();
            window.scrollTo({ top: 0, behavior: "smooth" });
          }}
        >
          {pending === 1 ? "1 yeni konu" : `${pending} yeni konu`} listeye girdi · Göster
        </button>
      ) : null}
    </div>
  );
}
