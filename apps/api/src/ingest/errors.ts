import { SafeFetchError } from "../lib/safe-http.ts";
import { FeedParseError } from "./feed-parser.ts";

/** Hata → kısa, güvenli kod + mesaj (yığın izi, bağlantı dizesi vb. içermez) */
export function describeError(error: unknown): { code: string; message: string } {
  if (error instanceof SafeFetchError)
    return { code: error.code, message: error.message.slice(0, 200) };
  if (error instanceof FeedParseError)
    return { code: "parse_error", message: error.message.slice(0, 200) };
  return { code: "unexpected", message: "Beklenmeyen hata" };
}
