"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { newSlugs } from "@/lib/refresh";
import styles from "./AutoRefresh.module.css";

/** Kontrol aralığı: veriler yaklaşık 10 dakikada bir değişir; 2 dakika yeterince günceldir */
const INTERVAL_MS = 120_000;
/** Bu kadar pikselden az kaydırılmışsa kullanıcı listenin başında sayılır */
const NEAR_TOP_PX = 300;
const nearTop = () => window.scrollY < NEAR_TOP_PX;

interface Props {
  slugs: string[];
  signature: string;
  category: string | null;
}

/**
 * Sayfa açıkken listeyi arka planda kontrol eder.
 * - Yalnızca skorlar/sıra değiştiyse sayfa sessizce yenilenir (kaydırma konumu korunur).
 * - Listeye YENİ konu girdiyse: sayfanın üstündeyse liste kendiliğinden güncellenir; aşağı
 *   kaydırmış okuyorsa önündeki liste değişmesin diye şerit gösterilir (yukarı çıkınca güncellenir).
 * - Sekme arka plandayken kontrol yapılmaz; sekmeye dönülünce hemen kontrol edilir.
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
      if (added.length > 0 && !nearTop()) setPending(added.length);
      else if (data.signature !== latest.current.signature) router.refresh();
    } catch {
      // Ağ hatası: bir sonraki kontrolde tekrar denenir; kullanıcıya hata gösterilmez
    }
  }, [category, router]);

  // Şerit açıkken kullanıcı listenin başına dönerse liste kendiliğinden güncellenir
  useEffect(() => {
    if (pending === 0) return;
    let done = false;
    const onScroll = () => {
      if (done || !nearTop()) return;
      done = true; // kaydırma boyunca tek yenileme
      router.refresh();
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [pending, router]);

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
