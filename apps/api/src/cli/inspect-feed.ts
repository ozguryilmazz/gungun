// Bir haber kaynağının RSS adresinin ne döndürdüğünü özetler (teşhis için; veritabanına yazmaz).
// Kullanım: pnpm feed:inspect milliyet        (yayıncı adı veya alan adının bir parçası)
//           pnpm feed:inspect https://www.milliyet.com.tr/rss/...   (yayıncının alan adındaki başka bir adres)
import { createDb, publishers } from "@gundemci/db";
import { eq } from "drizzle-orm";
import { loadConfig } from "../config.ts";
import { FeedParseError, parseFeed } from "../ingest/feed-parser.ts";
import { cleanText, hostBelongsTo } from "../ingest/normalize.ts";
import { BOT_USER_AGENT } from "../ingest/types.ts";
import { SafeFetchError, safeFetch } from "../lib/safe-http.ts";

const query = process.argv[2]?.trim();
if (!query) {
  console.error("Kullanım: pnpm feed:inspect <yayıncı adı | alan adı | adres>");
  process.exit(1);
}

const config = loadConfig();
const { db, close } = createDb(config.DATABASE_URL, { max: 1 });

try {
  const all = await db.select().from(publishers).where(eq(publishers.isMock, false));
  const isUrl = /^https?:\/\//i.test(query);
  const q = query.toLocaleLowerCase("tr-TR");
  const publisher = isUrl
    ? all.find((p) => hostBelongsTo(new URL(query).hostname, p.domain))
    : all.find((p) => p.name.toLocaleLowerCase("tr-TR").includes(q) || p.domain.includes(q));

  if (!publisher) {
    console.error(
      isUrl
        ? "Bu adres kayıtlı bir yayıncının alan adında değil (güvenlik gereği denenmez)."
        : "Yayıncı bulunamadı.",
    );
    process.exitCode = 1;
  } else {
    const target = isUrl ? query : publisher.feedUrl;
    if (!target) throw new Error("Yayıncının RSS adresi yok");
    const feedHost = new URL(target).hostname;
    console.log(`Yayıncı : ${publisher.name} (${publisher.domain})`);
    console.log(`Adres   : ${target}`);
    try {
      const res = await safeFetch(target, {
        isHostAllowed: (h) => h === feedHost || hostBelongsTo(h, publisher.domain),
        userAgent: BOT_USER_AGENT,
      });
      const head = cleanText(res.body.subarray(0, 4000).toString("utf8").replace(/\s+/g, " "), 400);
      console.log(`Durum   : HTTP ${res.status}`);
      console.log(`Son adr.: ${res.finalUrl}`);
      console.log(`Tür     : ${res.contentType || "(yok)"}`);
      console.log(`Boyut   : ${res.body.length} bayt`);
      const root = /<(rss|rdf:RDF|feed|html|urlset|sitemapindex)\b/i.exec(
        res.body.subarray(0, 4000).toString("utf8"),
      )?.[1];
      console.log(`Kök     : ${root ?? "(tanınmadı)"}`);
      try {
        const items = parseFeed(res.body, res.contentType, new Date(), res.finalUrl);
        console.log(`Öğe     : ${items.length}`);
        for (const i of items.slice(0, 3)) console.log(`  • ${i.title}\n    ${i.url}`);
      } catch (error) {
        console.log(`Ayrıştırma: ${error instanceof FeedParseError ? error.message : "başarısız"}`);
      }
      console.log(`Başlangıç (metin): ${head || "(boş)"}`);
      // İlk öğenin ham XML yapısı (etiket adlarını görmek için; kontrol karakterleri temizlenir)
      const firstItem = /<(item|entry)\b[\s\S]*?<\/(item|entry)>/i.exec(
        res.body.toString("utf8"),
      )?.[0];
      if (firstItem) {
        const safe = firstItem
          // eslint-disable-next-line no-control-regex
          .replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, "")
          .slice(0, 1500);
        console.log(`\nİlk öğenin ham yapısı:\n${safe}`);
      }
    } catch (error) {
      console.log(
        `Hata    : ${error instanceof SafeFetchError ? `${error.code} — ${error.message}` : "beklenmeyen hata"}`,
      );
    }
  }
} finally {
  await close();
}
