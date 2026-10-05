import type { Metadata } from "next";
import { YoutubeTrends } from "@/components/YoutubeTrends";
import { getYoutube } from "@/lib/data";
import { optional } from "@/lib/data/optional";
import styles from "../static-page.module.css";

export const metadata: Metadata = {
  title: "YouTube’da Türkiye trendleri",
  description: "YouTube’da Türkiye’de trend olan ilk 50 video (kaynak: YouTube).",
};

export const dynamic = "force-dynamic";

export default async function YoutubePage() {
  const data = await optional(getYoutube(50));
  return (
    <main id="icerik" className={`container ${styles.page}`}>
      <YoutubeTrends data={data} headingLevel="h1" />
    </main>
  );
}
