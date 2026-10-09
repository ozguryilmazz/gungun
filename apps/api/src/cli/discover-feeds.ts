// Haber sitelerinin RSS adreslerini bulur ve doğrular (veritabanına YAZMAZ).
// Kullanım:
//   pnpm feeds:discover --dizin https://www.gazeteler.de/   (dizin sayfasındaki tüm siteler)
//   pnpm feeds:discover https://www.ornek.com https://...    (belirli siteler)
// Her site için: robots.txt denetimi → ana sayfadaki RSS etiketi (yoksa yaygın adresler) → akışın
// gerçekten haber verdiği doğrulanır. Sonuç ekrana ve kök dizinde feeds-discovered.json dosyasına yazılır.
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  COMMON_FEED_PATHS,
  extractExternalSites,
  findFeedLinks,
  pageTitle,
} from "../ingest/discover.ts";
import { FeedParseError, parseFeed } from "../ingest/feed-parser.ts";
import { hostBelongsTo } from "../ingest/normalize.ts";
import { BOT_USER_AGENT } from "../ingest/types.ts";
import { checkRobots } from "../lib/robots.ts";
import { SafeFetchError, safeFetch, type FetchPolicy } from "../lib/safe-http.ts";
import { looksTurkish } from "../topics-pipeline/text.ts";

const OUT = fileURLToPath(new URL("../../../../feeds-discovered.json", import.meta.url));
const DELAY_MS = 1000;
const MIN_ITEMS = 5;

const args = process.argv.slice(2);
const dirIndex = args.indexOf("--dizin");
if (args.length === 0 || (dirIndex !== -1 && !args[dirIndex + 1])) {
  console.error(
    "Kullanım: pnpm feeds:discover --dizin <dizin sayfası> | <site adresi> [<site adresi> …]",
  );
  process.exit(1);
}

// Yerel, elle çalıştırılan araç: her public host'a izin var; iç ağ adresleri safeFetch'te yine engellenir
const policy = (accept?: string): FetchPolicy => ({
  isHostAllowed: () => true,
  userAgent: BOT_USER_AGENT,
  ...(accept ? { accept } : {}),
});
const robots = (url: string) =>
  checkRobots(safeFetch, url, { userAgent: BOT_USER_AGENT, botToken: "gundemciBot" });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const reason = (e: unknown) =>
  e instanceof SafeFetchError || e instanceof FeedParseError ? e.message : "beklenmeyen hata";

interface Result {
  site: string;
  name: string | null;
  domain: string;
  feedUrl: string | null;
  items: number;
  ownDomainPct: number;
  turkishPct: number;
  newest: string | null;
  ok: boolean;
  note: string;
}

async function tryFeed(url: string, domain: string) {
  const verdict = await robots(url);
  if (verdict === "disallowed") return { ok: false as const, note: "robots.txt izin vermiyor" };
  if (verdict === "unknown")
    return { ok: false as const, note: "siteye ulaşılamadı (robots.txt okunamadı)" };
  try {
    const res = await safeFetch(url, policy());
    const items = parseFeed(res.body, res.contentType, new Date(), res.finalUrl);
    const own = items.filter((i) => {
      try {
        return hostBelongsTo(new URL(i.url).hostname, domain);
      } catch {
        return false;
      }
    }).length;
    const tr = items.filter((i) => looksTurkish(i.title)).length;
    const dates = items.map((i) => i.publishedAt?.getTime() ?? 0).filter(Boolean);
    return {
      ok: true as const,
      feedUrl: res.finalUrl,
      items: items.length,
      ownDomainPct: items.length ? Math.round((own / items.length) * 100) : 0,
      turkishPct: items.length ? Math.round((tr / items.length) * 100) : 0,
      newest: dates.length ? new Date(Math.max(...dates)).toISOString() : null,
    };
  } catch (e) {
    return { ok: false as const, note: reason(e) };
  }
}

async function discover(site: string): Promise<Result> {
  const u = new URL(site);
  const domain = u.hostname.toLowerCase().replace(/^www\./, "");
  const base: Result = {
    site,
    name: null,
    domain,
    feedUrl: null,
    items: 0,
    ownDomainPct: 0,
    turkishPct: 0,
    newest: null,
    ok: false,
    note: "",
  };
  if ((await robots(site)) === "disallowed") return { ...base, note: "robots.txt izin vermiyor" };
  let candidates: string[] = [];
  try {
    const res = await safeFetch(site, policy("text/html"));
    const html = res.body.toString("utf8");
    base.name = pageTitle(html);
    candidates = findFeedLinks(html, res.finalUrl);
  } catch (e) {
    base.note = `ana sayfa açılamadı (${reason(e)})`;
  }
  candidates.push(
    ...COMMON_FEED_PATHS.map((p) => new URL(p, `${u.protocol}//${u.host}`).toString()),
  );
  let lastNote = base.note || "RSS bulunamadı";
  for (const c of [...new Set(candidates)].slice(0, 12)) {
    const r = await tryFeed(c, domain);
    if (!r.ok) {
      // Ana sayfa hatası yoksa ilk anlamlı neden (izin yok / ulaşılamadı) gösterilir
      if (lastNote === "RSS bulunamadı") lastNote = r.note;
      continue;
    }
    if (r.items < MIN_ITEMS) continue;
    const good = r.ownDomainPct >= 50 && r.turkishPct >= 50;
    return {
      ...base,
      ...r,
      ok: good,
      note: good
        ? "uygun"
        : r.turkishPct < 50
          ? "başlıklar Türkçe değil"
          : "bağlantılar başka siteye gidiyor",
    };
  }
  return { ...base, note: lastNote };
}

let sites: string[];
if (dirIndex !== -1) {
  const dir = args[dirIndex + 1]!;
  if ((await robots(dir)) !== "allowed") {
    console.error(
      "Dizin sayfasının robots.txt'i bu sayfaya izin vermiyor ya da okunamadı; durduruldu.",
    );
    process.exit(1);
  }
  const res = await safeFetch(dir, policy("text/html"));
  sites = extractExternalSites(res.body.toString("utf8"), res.finalUrl);
  console.log(`Dizinde ${sites.length} site bulundu: ${dir}\n`);
} else {
  sites = args.filter((a) => /^https?:\/\//i.test(a));
}

const results: Result[] = [];
for (const [i, site] of sites.entries()) {
  if (i > 0) await sleep(DELAY_MS);
  const r = await discover(site);
  results.push(r);
  const mark = r.ok ? "✔" : r.feedUrl ? "⚠" : "✖";
  const detail = r.feedUrl
    ? `${r.feedUrl} · ${r.items} öğe · %${r.ownDomainPct} kendi sitesi · %${r.turkishPct} Türkçe`
    : r.note;
  console.log(`${mark} ${(r.name ?? r.domain).slice(0, 40).padEnd(40)} ${detail}`);
}

writeFileSync(OUT, JSON.stringify(results, null, 2));
const ok = results.filter((r) => r.ok).length;
console.log(`\n${results.length} site denendi · ${ok} uygun RSS bulundu`);
console.log(`Ayrıntılar: ${OUT}`);
