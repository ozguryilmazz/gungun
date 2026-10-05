// Paylaşım görselleri (Open Graph) için ortak ayarlar. Yalnızca sunucuda.
import "server-only";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const OG_SIZE = { width: 1200, height: 630 };

const FONT_DIR = join(process.cwd(), "node_modules/@fontsource/schibsted-grotesk/files");

type OgFont = { name: string; data: ArrayBuffer; weight: 500 | 700; style: "normal" };
let cached: Promise<OgFont[]> | undefined;

/** Türkçe karakterler (ş, ğ, ı, İ) latin-ext dosyasında: ikisi birlikte yüklenir */
export function ogFonts(): Promise<OgFont[]> {
  cached ??= Promise.all(
    (["latin", "latin-ext"] as const).flatMap((subset) =>
      ([500, 700] as const).map(async (weight) => {
        const buf = await readFile(
          join(FONT_DIR, `schibsted-grotesk-${subset}-${weight}-normal.woff`),
        );
        return {
          name: "Schibsted Grotesk",
          data: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer,
          weight,
          style: "normal" as const,
        };
      }),
    ),
  );
  return cached;
}

export const OG_COLORS = {
  bg: "#f5f6f8",
  surface: "#ffffff",
  text: "#14181f",
  muted: "#4a5260",
  accent: "#0b5c7a",
  track: "#e9ecf0",
  mockBg: "#fff3dc",
  mockText: "#6b4300",
};
