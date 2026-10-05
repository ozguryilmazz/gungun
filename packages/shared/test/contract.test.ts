import { describe, expect, it } from "vitest";
import { SafeUrlSchema, SourceViewSchema, isValidSlug } from "../src/contract.ts";

describe("SafeUrlSchema", () => {
  it("yalnızca http(s) kabul eder", () => {
    expect(SafeUrlSchema.safeParse("https://example.org/a").success).toBe(true);
    expect(SafeUrlSchema.safeParse("http://example.org/a").success).toBe(true);
    for (const bad of [
      "javascript:alert(1)",
      "JAVASCRIPT:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "file:///etc/passwd",
      "ftp://example.org",
      "//example.org",
      "",
    ]) {
      expect(SafeUrlSchema.safeParse(bad).success, bad).toBe(false);
    }
  });

  it("kaynak bağlantısında tehlikeli şemayı reddeder", () => {
    const result = SourceViewSchema.safeParse({
      title: "x",
      url: "javascript:alert(1)",
      publisherName: "x",
      publishedAt: null,
    });
    expect(result.success).toBe(false);
  });
});

describe("isValidSlug", () => {
  it("geçerli slug", () => {
    expect(isValidSlug("ornek-faiz-karari-beklentisi")).toBe(true);
  });

  it("path traversal, büyük harf, özel karakter ve aşırı uzunluk reddedilir", () => {
    for (const bad of [
      "../etc/passwd",
      "Ornek",
      "a--b",
      "-a",
      "a-",
      "a b",
      "a%2F",
      "ğ",
      "a".repeat(161),
    ]) {
      expect(isValidSlug(bad), bad).toBe(false);
    }
  });
});
