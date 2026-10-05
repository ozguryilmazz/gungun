import { ImageResponse } from "next/og";
import { getTopic } from "@/lib/data";
import { formatSearchVolume } from "@/lib/format";
import { OG_COLORS as C, OG_SIZE, ogFonts } from "@/lib/og";

export const size = OG_SIZE;
export const contentType = "image/png";
export const alt = "gündemci — konu paylaşım görseli";

/** Konu paylaşım görseli: başlık, kategori, skor ve (varsa) yaklaşık arama sayısı. Uydurma metin yok. */
export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const result = await getTopic((await params).slug).catch(() => null);
  const t = result?.item;
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
        {t?.isMock ? (
          <div
            style={{
              marginLeft: "auto",
              background: C.mockBg,
              color: C.mockText,
              fontSize: 24,
              fontWeight: 700,
              padding: "8px 16px",
              borderRadius: 8,
            }}
          >
            ÖRNEK VERİ
          </div>
        ) : null}
      </div>

      <div
        style={{
          marginTop: 40,
          flex: 1,
          display: "flex",
          flexDirection: "column",
          background: C.surface,
          borderRadius: 24,
          padding: "40px 48px",
        }}
      >
        <div style={{ fontSize: 26, fontWeight: 700, color: C.muted, letterSpacing: 1 }}>
          {t
            ? `${t.category.name.toLocaleUpperCase("tr-TR")} · NEDEN GÜNDEMDE?`
            : "NEDEN GÜNDEMDE?"}
        </div>
        <div
          style={{
            marginTop: 16,
            fontSize: (t?.title.length ?? 0) > 40 ? 56 : 72,
            fontWeight: 700,
            lineHeight: 1.1,
            display: "flex",
          }}
        >
          {t?.title ?? "Türkiye’de şu anda ne aranıyor?"}
        </div>
        <div style={{ marginTop: "auto", display: "flex", alignItems: "flex-end", gap: 32 }}>
          {t?.score != null ? (
            <div style={{ display: "flex", alignItems: "baseline" }}>
              <span style={{ fontSize: 88, fontWeight: 700 }}>{t.score}</span>
              <span style={{ fontSize: 32, color: C.muted }}>/100 gündem skoru</span>
            </div>
          ) : null}
          {t?.searchVolume ? (
            <div style={{ fontSize: 30, color: C.muted, paddingBottom: 14 }}>
              {formatSearchVolume(t.searchVolume)}
            </div>
          ) : null}
        </div>
      </div>
      <div style={{ marginTop: 20, fontSize: 24, color: C.muted, display: "flex" }}>
        Skor ne kadar arandığını ölçer, önemini değil · Kaynaklar ve ayrıntılar sitede
      </div>
    </div>,
    { ...OG_SIZE, fonts },
  );
}
