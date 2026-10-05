import { describe, expect, it } from "vitest";
import type { Fetcher } from "../src/ingest/types.ts";
import { checkRobots, clearRobotsCache, isPathAllowed, parseRobots } from "../src/lib/robots.ts";
import { SafeFetchError } from "../src/lib/safe-http.ts";

const TXT = `
# yorum
User-agent: *
Disallow: /search
Allow: /search/about
Disallow: /*.pdf$

User-agent: BadBot
User-agent: gundemciBot
Disallow: /private
`;

describe("robots.txt", () => {
  it("kendi bot adımıza özel grup varsa o kullanılır", () => {
    const own = parseRobots(TXT, "gundemciBot");
    expect(own.disallow).toEqual(["/private"]);
    expect(isPathAllowed(own, "/search?q=x")).toBe(true);
    expect(isPathAllowed(own, "/private/a")).toBe(false);
  });

  it("yoksa '*' grubu; en uzun kural kazanır, joker ve $ desteklenir", () => {
    const rules = parseRobots(TXT, "baskaBot");
    expect(isPathAllowed(rules, "/search?q=x")).toBe(false);
    expect(isPathAllowed(rules, "/search/about")).toBe(true);
    expect(isPathAllowed(rules, "/a/b.pdf")).toBe(false);
    expect(isPathAllowed(rules, "/a/b.pdf?x=1")).toBe(true);
    expect(isPathAllowed(rules, "/rss/search?q=x")).toBe(true);
  });

  it("boş Disallow her şeye izin verir; 'Disallow: /' hiçbir şeye", () => {
    expect(isPathAllowed(parseRobots("User-agent: *\nDisallow:", "x"), "/a")).toBe(true);
    expect(isPathAllowed(parseRobots("User-agent: *\nDisallow: /", "x"), "/a")).toBe(false);
  });

  it("robots.txt yoksa (404) izinli; okunamazsa 'unknown' (istek atılmaz)", async () => {
    const make =
      (err: SafeFetchError): Fetcher =>
      async () => {
        throw err;
      };
    clearRobotsCache();
    expect(
      await checkRobots(
        make(new SafeFetchError("http_error", "HTTP 404", 404)),
        "https://a.example/x",
        {
          userAgent: "t",
          botToken: "gundemciBot",
        },
      ),
    ).toBe("allowed");
    expect(
      await checkRobots(make(new SafeFetchError("timeout", "Zaman aşımı")), "https://b.example/x", {
        userAgent: "t",
        botToken: "gundemciBot",
      }),
    ).toBe("unknown");
  });
});
