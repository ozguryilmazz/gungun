import type { TopicSummary } from "@gundemci/shared";

const TIME_ZONE = "Europe/Istanbul";

const clockFormatter = new Intl.DateTimeFormat("tr-TR", {
  timeZone: TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
});

const dateFormatter = new Intl.DateTimeFormat("tr-TR", {
  timeZone: TIME_ZONE,
  day: "numeric",
  month: "long",
  year: "numeric",
});

/** "az önce", "4 dk önce", "2 saat önce", "3 gün önce" */
export function formatRelative(iso: string, now: Date = new Date()): string {
  const diffMs = now.getTime() - new Date(iso).getTime();
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "az önce";
  if (minutes < 60) return `${minutes} dk önce`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} saat önce`;
  return `${Math.floor(hours / 24)} gün önce`;
}

/** İstanbul saatine göre "14:05" */
export function formatClock(iso: string): string {
  return clockFormatter.format(new Date(iso));
}

/** İstanbul saatine göre "5 Ekim 2026" */
export function formatDate(date: Date): string {
  return dateFormatter.format(date);
}

/** +67%, −52% (gerçek eksi işareti), 0% */
export function formatChange(pct: number): string {
  if (pct > 0) return `+${pct}%`;
  if (pct < 0) return `−${Math.abs(pct)}%`;
  return "0%";
}

export const TREND_LABELS: Record<TopicSummary["trend"], string> = {
  surging: "Hızla yükseliyor",
  rising: "Yükseliyor",
  flat: "Yatay",
  falling: "Düşüyor",
  unknown: "Değişim verisi yok",
};

export const TREND_ARROWS: Record<TopicSummary["trend"], string> = {
  surging: "▲",
  rising: "▲",
  flat: "—",
  falling: "▼",
  unknown: "",
};
