import { TopicFeed } from "@/components/TopicFeed";
import { getFalling, getRising, getTopicList } from "@/lib/data";

// Liste en fazla 60 saniyede bir yeniden oluşturulur
export const revalidate = 60;

export default async function HomePage() {
  const [list, rising, falling] = await Promise.all([getTopicList(), getRising(), getFalling()]);
  return (
    <TopicFeed
      heading="Bugün Türkiye’de gündem"
      activeCategory={null}
      list={list}
      rising={rising}
      falling={falling}
    />
  );
}
