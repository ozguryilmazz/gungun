import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { TopicFeed } from "@/components/TopicFeed";
import { getCategory, getFalling, getRising, getTopicList } from "@/lib/data";

export const revalidate = 60;

interface Props {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const category = getCategory((await params).slug);
  if (!category) return {};
  return {
    title: `${category.name} gündemi`,
    description: `Türkiye’de ${category.name.toLocaleLowerCase("tr-TR")} kategorisinde şu anda konuşulan konular.`,
  };
}

export default async function CategoryPage({ params }: Props) {
  // Yalnızca tanımlı kategoriler; diğer her değer 404
  const category = getCategory((await params).slug);
  if (!category) notFound();

  const [list, rising, falling] = await Promise.all([
    getTopicList({ category: category.slug }),
    getRising(),
    getFalling(),
  ]);
  return (
    <TopicFeed
      heading={`${category.name} gündemi`}
      activeCategory={category.slug}
      list={list}
      rising={rising}
      falling={falling}
    />
  );
}
