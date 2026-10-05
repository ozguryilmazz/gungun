import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { findCategory } from "@gundemci/shared";
import { TopicFeed } from "@/components/TopicFeed";
import { getFalling, getRising, getStatus, getTopicList } from "@/lib/data";
import { optional } from "@/lib/data/optional";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const category = findCategory((await params).slug);
  if (!category) return {};
  return {
    title: `${category.name} gündemi`,
    description: `Türkiye’de ${category.name.toLocaleLowerCase("tr-TR")} kategorisinde şu anda konuşulan konular.`,
  };
}

export default async function CategoryPage({ params }: Props) {
  // Yalnızca tanımlı kategoriler; diğer her değer API'ye gitmeden 404
  const category = findCategory((await params).slug);
  if (!category) notFound();

  const [list, rising, falling, status] = await Promise.all([
    getTopicList({ category: category.slug }),
    optional(getRising()),
    optional(getFalling()),
    optional(getStatus()),
  ]);
  return (
    <TopicFeed
      heading={`${category.name} gündemi`}
      activeCategory={category.slug}
      list={list}
      rising={rising}
      falling={falling}
      status={status}
    />
  );
}
