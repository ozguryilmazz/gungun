import type { Metadata } from "next";
import { NewsStories } from "@/components/NewsStories";
import { getStories } from "@/lib/data";
import { optional } from "@/lib/data/optional";
import styles from "../static-page.module.css";

export const metadata: Metadata = {
  title: "Çok sitede yayımlanan haberler",
  description:
    "Son 24 saatte en az 3 haber sitesinin yayımladığı haberler, yayımlayan site sayısına göre.",
};

export const dynamic = "force-dynamic";

export default async function StoriesPage() {
  const data = await optional(getStories(15));
  return (
    <main id="icerik" className={`container ${styles.page}`}>
      <NewsStories data={data} headingLevel="h1" />
    </main>
  );
}
