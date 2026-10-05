import type { Metadata } from "next";
import {
  CHANGE_WINDOW_HOURS,
  COMPONENT_KEYS,
  COMPONENT_LABELS,
  RISING_MIN_SOURCES,
  SCORE_WEIGHTS,
} from "@gundemci/shared";
import styles from "../static-page.module.css";

export const metadata: Metadata = {
  title: "Gündem skoru nasıl hesaplanır?",
  description: "gündemci gündem skorunun hangi sinyallerden ve nasıl hesaplandığının açıklaması.",
};

const DESCRIPTIONS: Record<(typeof COMPONENT_KEYS)[number], string> = {
  news_visibility:
    "Son saatlerde konuyu yazan farklı yayıncı sayısı. Aynı sitenin çok sayıda haberi skoru şişirmez.",
  velocity: "Konuyla ilgili kaynak sayısının son saatte, önceki saatlere göre ne kadar arttığı.",
  search_interest:
    "Konunun Türkiye’deki Google arama trendlerinde yer alıp almadığı ve yaklaşık ilgi düzeyi.",
  social: "Kamuya açık sosyal medya sinyalleri. Bu veri kaynağı henüz bağlanmadı.",
};

export default function ScoreExplainerPage() {
  return (
    <main id="icerik" className={`container ${styles.page}`}>
      <h1 className={styles.title}>Gündem skoru nasıl hesaplanır?</h1>
      <p className={styles.lead}>
        Gündem skoru, bir konunun şu anda internette <strong>ne kadar konuşulduğunu</strong> 0–100
        arasında gösterir. Bir konunun <strong>ne kadar önemli</strong> olduğunu ölçmez: çok
        konuşulan bir konu önemsiz, az konuşulan bir konu çok önemli olabilir.
      </p>

      <section className={styles.section}>
        <h2 className={styles.h2}>Sinyaller ve ağırlıkları</h2>
        <ul className={styles.list}>
          {COMPONENT_KEYS.map((key) => (
            <li key={key}>
              <span className={styles.rowHead}>
                <strong>{COMPONENT_LABELS[key]}</strong>
                <span className="mono">%{Math.round(SCORE_WEIGHTS[key] * 100)}</span>
              </span>
              <span>{DESCRIPTIONS[key]}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className={styles.section}>
        <h2 className={styles.h2}>Eksik veri nasıl ele alınır?</h2>
        <p>
          Bir sinyal için veri yoksa o sinyal skora <strong>katılmaz</strong> ve sayfada “Veri
          bekleniyor” olarak gösterilir; eksik veri tahmin edilmez veya uydurulmaz. Skor yalnızca
          verisi olan sinyallerin ağırlıklı ortalamasıdır ve kaç sinyalden hesaplandığı her konuda
          yazar (örneğin “3/4 sinyal”). Hiçbir sinyal yoksa skor gösterilmez.
        </p>
      </section>

      <section className={styles.section}>
        <h2 className={styles.h2}>Yükselenler ve düşenler</h2>
        <p>
          Değişim yüzdesi, şu anki skorun {CHANGE_WINDOW_HOURS} saat önceki skorla
          karşılaştırılmasıdır ve yalnızca iki gerçek ölçüm varsa hesaplanır. Çok az kaynaktan doğan
          abartılı artışları önlemek için “Şu anda yükselenler” listesine yalnızca en az{" "}
          {RISING_MIN_SOURCES} kaynakta yer alan konular girer.
        </p>
      </section>

      <section className={styles.section}>
        <h2 className={styles.h2}>Kaynaklar ve telif</h2>
        <p>
          gündemci haber üretmez ve haber metinlerini kopyalamaz. Kaynaklardan yalnızca başlık,
          yayıncı adı, yayın zamanı ve bağlantı alınır; okumak için orijinal habere
          yönlendirilirsiniz.
        </p>
      </section>
    </main>
  );
}
