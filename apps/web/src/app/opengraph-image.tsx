import { ImageResponse } from "next/og";
import { getTopicList } from "@/lib/data";
import { OG_COLORS as C, OG_SIZE, ogFonts } from "@/lib/og";

export const size = OG_SIZE;
export const contentType = "image/png";
export const alt = "gündemci — Türkiye’de şu anda ne aranıyor?";
export const dynamic = "force-dynamic";

/** Ana sayfa paylaşım görseli: o anki ilk 3 trend arama */
export default async function Image() {
  const list = await getTopicList({ limit: 3 }).catch(() => null);
  const fonts = await ogFonts();
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        background: C.bg,
        padding: 56,
        fontFamily: "Schibsted Grotesk",
        color: C.text,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        <div
          style={{
            width: 56,
            height: 56,
            borderRadius: 12,
            background: C.accent,
            color: "#fff",
            fontSize: 40,
            fontWeight: 700,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          g
        </div>
        <div style={{ fontSize: 40, fontWeight: 700 }}>gündemci</div>
      </div>
      <div style={{ marginTop: 36, fontSize: 60, fontWeight: 700, display: "flex" }}>
        Türkiye’de şu anda ne aranıyor?
      </div>
      <div style={{ marginTop: 28, display: "flex", flexDirection: "column", gap: 14 }}>
        {(list?.items ?? []).map((t, i) => (
          <div
            key={t.slug}
            style={{
              display: "flex",
              alignItems: "center",
              background: C.surface,
              borderRadius: 16,
              padding: "16px 28px",
              fontSize: 38,
              fontWeight: 700,
            }}
          >
            <span style={{ color: C.muted, width: 56 }}>{i + 1}</span>
            <span style={{ flex: 1 }}>{t.title}</span>
            {t.score != null ? <span style={{ color: C.accent }}>{t.score}</span> : null}
          </div>
        ))}
      </div>
    </div>,
    { ...OG_SIZE, fonts },
  );
}
