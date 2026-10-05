// Sayfa açıkken "liste değişti mi?" kontrolü için hafif özet (aynı kökenden; tarayıcı backend'e
// doğrudan bağlanmaz). Yalnızca sıra ve skor imzası döner; içerik dönmez.
import { findCategory } from "@gundemci/shared";
import { getTopicList } from "@/lib/data";
import { listSignature } from "@/lib/refresh";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const raw = new URL(request.url).searchParams.get("kategori");
  // Yalnızca tanımlı kategoriler; diğer her değer reddedilir
  const category = raw === null ? undefined : findCategory(raw)?.slug;
  if (raw !== null && !category) return Response.json({ error: "not_found" }, { status: 404 });
  try {
    const list = await getTopicList(category ? { category } : {});
    return Response.json(
      { slugs: list.items.map((t) => t.slug), signature: listSignature(list.items) },
      { headers: { "cache-control": "no-store" } },
    );
  } catch {
    return Response.json({ error: "unavailable" }, { status: 503 });
  }
}
