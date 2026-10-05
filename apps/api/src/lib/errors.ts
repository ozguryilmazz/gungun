import type { FastifyReply } from "fastify";
import type { ErrorResponse } from "@gundemci/shared";

type ErrorCode = ErrorResponse["error"]["code"];

/** Kullanıcıya gösterilebilir Türkçe mesajlar — teknik ayrıntı içermez */
const MESSAGES: Record<ErrorCode, string> = {
  invalid_request: "Geçersiz istek.",
  not_found: "Aradığınız içerik bulunamadı.",
  rate_limited: "Çok fazla istek gönderildi. Lütfen biraz sonra tekrar deneyin.",
  internal_error: "Bu veri şu anda güncellenemiyor.",
  service_unavailable: "Hizmet şu anda kullanılamıyor.",
};

const STATUS: Record<ErrorCode, number> = {
  invalid_request: 400,
  not_found: 404,
  rate_limited: 429,
  internal_error: 500,
  service_unavailable: 503,
};

export function errorBody(code: ErrorCode): ErrorResponse {
  return { error: { code, message: MESSAGES[code] } };
}

export function sendError(reply: FastifyReply, code: ErrorCode) {
  return reply.code(STATUS[code]).header("cache-control", "no-store").send(errorBody(code));
}
