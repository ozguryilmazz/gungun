import { TopicFeed } from "@/components/TopicFeed";
import { getFalling, getRising, getStatus, getTopicList } from "@/lib/data";
import { optional } from "@/lib/data/optional";

// Her istekte API'den okunur (API ve fetch önbelleği 30 sn)
export const dynamic = "force-dynamic";

export default async function HomePage() {
  // Ana liste zorunlu: alınamazsa hata sayfası. Diğer bölümler isteğe bağlı.
  const [list, rising, falling, status] = await Promise.all([
    getTopicList(),
    optional(getRising()),
    optional(getFalling()),
    optional(getStatus()),
  ]);
  return (
    <TopicFeed
      heading="Bugün Türkiye’de gündem"
      activeCategory={null}
      list={list}
      rising={rising}
      falling={falling}
      status={status}
    />
  );
}
