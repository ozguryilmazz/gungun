// robots.txt denetimi. Bir sitenin botlara kapattığı sayfalara istek ATILMAZ.
// Kurallar: kendi bot adımıza (gundemciBot) özel grup varsa o, yoksa "*" grubu kullanılır;
// en uzun eşleşen Allow/Disallow kuralı kazanır, eşitlikte Allow (Google'ın yorumu).
import type { Fetcher } from "../ingest/types.ts";
import { SafeFetchError } from "./safe-http.ts";

export interface RobotsRules {
  allow: string[];
  disallow: string[];
}

/** robots.txt metninden bot adımıza uygulanacak kuralları çıkarır */
export function parseRobots(txt: string, botToken: string): RobotsRules {
  const token = botToken.toLowerCase();
  const groups: { agents: string[]; rules: RobotsRules }[] = [];
  let current: { agents: string[]; rules: RobotsRules } | null = null;
  let lastWasAgent = false;

  for (const rawLine of txt.split(/\r?\n/).slice(0, 5000)) {
    const line = rawLine.replace(/#.*/, "").trim();
    const m = /^([a-zA-Z-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const field = m[1]!.toLowerCase();
    const value = m[2]!.trim();
    if (field === "user-agent") {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: { allow: [], disallow: [] } };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!current) continue;
    if (field === "allow" && value) current.rules.allow.push(value);
    if (field === "disallow" && value) current.rules.disallow.push(value);
  }

  const own = groups.filter((g) => g.agents.some((a) => a !== "*" && token.includes(a)));
  const chosen = own.length ? own : groups.filter((g) => g.agents.includes("*"));
  return {
    allow: chosen.flatMap((g) => g.rules.allow),
    disallow: chosen.flatMap((g) => g.rules.disallow),
  };
}

/** Kural deseni ("*" joker, "$" son) yola uyuyor mu? Uyuyorsa desen uzunluğu, uymuyorsa -1 */
function matchLength(pattern: string, path: string): number {
  const anchored = pattern.endsWith("$");
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const regex = new RegExp(
    "^" +
      body
        .split("*")
        .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
        .join(".*") +
      (anchored ? "$" : ""),
  );
  return regex.test(path) ? pattern.length : -1;
}

/** Yol (sorgu dizesiyle, ör. "/rss/search?q=x") bu kurallara göre taranabilir mi? */
export function isPathAllowed(rules: RobotsRules, path: string): boolean {
  const best = (patterns: string[]) => Math.max(-1, ...patterns.map((p) => matchLength(p, path)));
  const allow = best(rules.allow);
  const disallow = best(rules.disallow);
  return disallow === -1 || allow >= disallow;
}

export type RobotsVerdict = "allowed" | "disallowed" | "unknown";

const cache = new Map<string, { rules: RobotsRules | "allow_all"; expiresAt: number }>();
const CACHE_MS = 6 * 3_600_000;

/** Yalnızca testler için */
export function clearRobotsCache() {
  cache.clear();
}

/**
 * Bir adresin robots.txt'e göre taranıp taranamayacağı. robots.txt yoksa (404) izinli sayılır;
 * okunamıyorsa (ağ hatası, 5xx) "unknown" döner ve istek ATILMAZ (temkinli varsayılan).
 */
export async function checkRobots(
  fetcher: Fetcher,
  url: string,
  options: { userAgent: string; botToken: string; now?: number },
): Promise<RobotsVerdict> {
  const target = new URL(url);
  const now = options.now ?? Date.now();
  let entry = cache.get(target.origin);
  if (!entry || entry.expiresAt <= now) {
    try {
      const res = await fetcher(`${target.origin}/robots.txt`, {
        isHostAllowed: (h) => h === target.hostname,
        userAgent: options.userAgent,
        accept: "text/plain",
        maxBytes: 512 * 1024,
      });
      entry = {
        rules: parseRobots(res.body.toString("utf8"), options.botToken),
        expiresAt: now + CACHE_MS,
      };
    } catch (error) {
      if (error instanceof SafeFetchError && (error.status === 404 || error.status === 410)) {
        entry = { rules: "allow_all", expiresAt: now + CACHE_MS };
      } else {
        return "unknown";
      }
    }
    cache.set(target.origin, entry);
  }
  if (entry.rules === "allow_all") return "allowed";
  return isPathAllowed(entry.rules, target.pathname + target.search) ? "allowed" : "disallowed";
}
