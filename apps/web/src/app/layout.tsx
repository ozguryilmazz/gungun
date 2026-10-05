import type { Metadata, Viewport } from "next";
import "@fontsource-variable/schibsted-grotesk";
import "@fontsource/ibm-plex-mono/500.css";
import "@fontsource/ibm-plex-mono/600.css";
import "./globals.css";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";

export const metadata: Metadata = {
  title: {
    default: "gündemci — Türkiye’de şu anda ne konuşuluyor?",
    template: "%s | gündemci",
  },
  description:
    "Türkiye’de internette ne konuşuluyor, neden gündemde ve ne kadar hızlı yükseliyor? Kaynaklara bağlantı veren tarafsız gündem takibi.",
  // Canlıya geçene kadar (ve örnek veri gösterilirken) arama motorlarına kapalı.
  // SEO ayarları aşama 11'de.
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#ffffff",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="tr">
      <body>
        <a href="#icerik" className="skip-link">
          İçeriğe geç
        </a>
        <SiteHeader />
        {children}
        <SiteFooter />
      </body>
    </html>
  );
}
