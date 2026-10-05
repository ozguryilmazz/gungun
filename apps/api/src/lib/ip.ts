import { BlockList, isIP } from "node:net";

// Dış isteklerde bağlanılmasına İZİN VERİLMEYEN adres aralıkları (SSRF koruması):
// özel ağlar, loopback, link-local (bulut metadata 169.254.169.254 dahil), CGNAT,
// multicast, ayrılmış ve belgeleme aralıkları.
const blocked = new BlockList();
for (const [net, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  blocked.addSubnet(net, prefix, "ipv4");
}
for (const [net, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["64:ff9b::", 96],
  ["100::", 64],
  ["2001:db8::", 32],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const) {
  blocked.addSubnet(net, prefix, "ipv6");
}

// Not: IPv4-mapped (::ffff:a.b.c.d) aralığı listeye EKLENMEZ — Node BlockList bu kuralı
// tüm IPv4 adreslerine uygular. Mapped adresler isPublicAddress içinde IPv4'e çevrilip denetlenir.

/** Adres herkese açık (public) bir internet adresi mi? */
export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 0) return false;
  if (family === 6) {
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
    if (mapped?.[1]) return isPublicAddress(mapped[1]);
    return !blocked.check(address, "ipv6");
  }
  return !blocked.check(address, "ipv4");
}
