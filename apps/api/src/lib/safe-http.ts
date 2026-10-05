// SSRF korumalı HTTP istemcisi. Dış kaynaklara yapılan TÜM istekler buradan geçer.
//
// Korumalar:
//  - Yalnızca izin verilen protokol (varsayılan https) ve standart port
//  - Yalnızca allowlist'teki host'lar (yönlendirme hedefleri dahil)
//  - DNS çözümlemesi bağlantı anında yapılır ve özel/iç ağ adresleri reddedilir
//    (bağlantı doğrulanan IP'ye kurulur → DNS rebinding açığı yok)
//  - Toplam zaman aşımı, yanıt boyutu sınırı (sıkıştırma açıldıktan SONRA da), en fazla 3 yönlendirme
//  - Kimlik bilgisi içeren adresler reddedilir
import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import http from "node:http";
import https from "node:https";
import { isIP, type LookupFunction } from "node:net";
import { createBrotliDecompress, createGunzip, createInflate } from "node:zlib";
import type { Readable } from "node:stream";
import { isPublicAddress } from "./ip.ts";

export interface FetchPolicy {
  /** Host izin kontrolü (tam eşleşme veya alan adı kuralı) */
  isHostAllowed: (host: string) => boolean;
  protocols?: readonly ("https:" | "http:")[];
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  userAgent: string;
  /** YALNIZCA testler için: yerel test sunucusuna (özel adres + rastgele port) izin verir */
  allowPrivateAddresses?: boolean;
}

export interface SafeResponse {
  status: number;
  finalUrl: string;
  contentType: string;
  body: Buffer;
}

export type SafeFetchErrorCode =
  | "blocked_url"
  | "blocked_host"
  | "blocked_address"
  | "dns_error"
  | "timeout"
  | "too_large"
  | "too_many_redirects"
  | "http_error"
  | "network_error";

export class SafeFetchError extends Error {
  constructor(
    readonly code: SafeFetchErrorCode,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "SafeFetchError";
  }
}

const DEFAULTS = { timeoutMs: 15_000, maxBytes: 3 * 1024 * 1024, maxRedirects: 3 };

function checkUrl(raw: string, policy: FetchPolicy): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new SafeFetchError("blocked_url", "Geçersiz adres");
  }
  const protocols = policy.protocols ?? ["https:"];
  if (!(protocols as readonly string[]).includes(url.protocol)) {
    throw new SafeFetchError("blocked_url", `İzin verilmeyen protokol: ${url.protocol}`);
  }
  if (url.username || url.password)
    throw new SafeFetchError("blocked_url", "Kimlik bilgisi içeren adres");
  if (url.port !== "" && !policy.allowPrivateAddresses)
    throw new SafeFetchError("blocked_url", "Standart dışı port");
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  // IP adresiyle doğrudan istek: DNS adımı olmadığı için burada kontrol edilir
  if (isIP(host) !== 0 && !policy.allowPrivateAddresses && !isPublicAddress(host)) {
    throw new SafeFetchError("blocked_address", "İç ağ adresine istek engellendi");
  }
  if (!policy.allowPrivateAddresses && (host === "localhost" || host.endsWith(".localhost"))) {
    throw new SafeFetchError("blocked_host", "Yerel adres");
  }
  if (!policy.isHostAllowed(host))
    throw new SafeFetchError("blocked_host", `İzin listesinde olmayan host: ${host}`);
  return url;
}

/** DNS sonucunu doğrulayan lookup: bağlantı yalnızca public adreslere kurulur */
function guardedLookup(allowPrivate: boolean): LookupFunction {
  return (hostname, options, callback) => {
    dnsLookup(hostname, { ...options, all: true }, (err, addresses: LookupAddress[]) => {
      if (err) return callback(err, "", 4);
      const usable = allowPrivate ? addresses : addresses.filter((a) => isPublicAddress(a.address));
      if (usable.length === 0) {
        const e = Object.assign(new Error("blocked_address"), { code: "EBLOCKEDADDR" });
        return callback(e, "", 4);
      }
      if (options.all)
        return (callback as unknown as (e: null, a: LookupAddress[]) => void)(null, usable);
      const first = usable[0]!;
      return callback(null, first.address, first.family);
    });
  };
}

function decode(res: http.IncomingMessage): Readable {
  const enc = String(res.headers["content-encoding"] ?? "").toLowerCase();
  if (enc === "gzip" || enc === "x-gzip") return res.pipe(createGunzip());
  if (enc === "deflate") return res.pipe(createInflate());
  if (enc === "br") return res.pipe(createBrotliDecompress());
  return res;
}

function requestOnce(
  url: URL,
  policy: FetchPolicy,
  deadline: number,
): Promise<SafeResponse | { redirect: string }> {
  return new Promise((resolve, reject) => {
    const remaining = deadline - Date.now();
    if (remaining <= 0) return reject(new SafeFetchError("timeout", "Zaman aşımı"));
    const maxBytes = policy.maxBytes ?? DEFAULTS.maxBytes;
    const client = url.protocol === "https:" ? https : http;

    const req = client.request(
      url,
      {
        method: "GET",
        lookup: guardedLookup(policy.allowPrivateAddresses === true),
        headers: {
          "user-agent": policy.userAgent,
          accept:
            "application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.9, */*;q=0.1",
          "accept-encoding": "gzip, deflate, br",
        },
        timeout: remaining,
      },
      (res) => {
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400 && res.headers.location) {
          res.resume();
          return resolve({ redirect: new URL(res.headers.location, url).toString() });
        }
        if (status < 200 || status >= 300) {
          res.resume();
          return reject(new SafeFetchError("http_error", `HTTP ${status}`, status));
        }
        const declared = Number(res.headers["content-length"] ?? 0);
        if (declared > maxBytes) {
          res.destroy();
          return reject(new SafeFetchError("too_large", "Yanıt çok büyük"));
        }
        const chunks: Buffer[] = [];
        let size = 0;
        const stream = decode(res);
        stream.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > maxBytes) {
            stream.destroy();
            res.destroy();
            reject(new SafeFetchError("too_large", "Yanıt çok büyük"));
            return;
          }
          chunks.push(chunk);
        });
        stream.on("end", () =>
          resolve({
            status,
            finalUrl: url.toString(),
            contentType: String(res.headers["content-type"] ?? ""),
            body: Buffer.concat(chunks),
          }),
        );
        stream.on("error", () => reject(new SafeFetchError("network_error", "Yanıt okunamadı")));
      },
    );
    req.on("timeout", () => req.destroy(new SafeFetchError("timeout", "Zaman aşımı")));
    req.on("error", (err: NodeJS.ErrnoException) => {
      if (err instanceof SafeFetchError) return reject(err);
      if (err.code === "EBLOCKEDADDR")
        return reject(new SafeFetchError("blocked_address", "İç ağ adresine istek engellendi"));
      if (err.code === "ENOTFOUND" || err.code === "EAI_AGAIN")
        return reject(new SafeFetchError("dns_error", "Alan adı çözümlenemedi"));
      reject(new SafeFetchError("network_error", err.code ?? "Ağ hatası"));
    });
    req.end();
  });
}

export async function safeFetch(rawUrl: string, policy: FetchPolicy): Promise<SafeResponse> {
  const deadline = Date.now() + (policy.timeoutMs ?? DEFAULTS.timeoutMs);
  const maxRedirects = policy.maxRedirects ?? DEFAULTS.maxRedirects;
  let url = checkUrl(rawUrl, policy);
  for (let i = 0; i <= maxRedirects; i++) {
    const result = await requestOnce(url, policy, deadline);
    if (!("redirect" in result)) return result;
    // Her yönlendirme hedefi baştan doğrulanır (protokol, host, port)
    url = checkUrl(result.redirect, policy);
  }
  throw new SafeFetchError("too_many_redirects", "Çok fazla yönlendirme");
}
