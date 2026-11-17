import { APICallError } from "ai";
import {
  failureFromStatus,
  failureFromText,
  failureResetFromText,
  sanitizeFailureText,
  failureRetryable,
  type AgentFailure,
  type AgentFailureClass,
} from "@ai-projector/core/modules/agent-failure/index.ts";

/** Network codes that mean the same thing as a dropped connection. */
const TRANSIENT_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "EAI_AGAIN",
  "EPIPE",
  "ENOTFOUND",
]);

/** A failure assembled from parts already known to the caller. */
export function makeFailure(input: {
  message?: string | undefined;
  code?: string | null;
  class?: AgentFailureClass | undefined;
  status?: number | null;
  statusClass?: AgentFailureClass | undefined;
  retryable?: boolean | null;
  resetAt?: number | null;
}): AgentFailure {
  const raw = input.message?.trim() || "Ошибка агента";
  const message = sanitizeFailureText(raw) || "Ошибка агента";
  const fallbackClass =
    input.statusClass ?? failureFromStatus(input.status) ?? failureFromText(message);
  const failureClass = input.class ?? fallbackClass;
  const failure: AgentFailure = {
    class: failureClass,
    message,
    code: input.code ?? (input.status ? `http_${input.status}` : null),
    retryable:
      input.retryable ??
      (failureClass === "usage_limit" ||
      failureClass === "transport_error" ||
      failureClass === "provider_error"
        ? true
        : failureClass === "permission_error" || failureClass === "validation_error"
          ? false
          : null),
  };
  const resetAt = input.resetAt ?? undefined;
  if (failure.class === "usage_limit" && resetAt !== undefined && Number.isFinite(resetAt)) {
    failure.resetAt = resetAt;
  }
  return failure;
}

/** A failure from any thrown value: AI SDK errors keep their status and retry advice. */
export function failureFromError(error: unknown, fallback = "Ошибка агента"): AgentFailure {
  if (APICallError.isInstance(error)) {
    const status = error.statusCode ?? null;
    return makeFailure({
      message: error.message || fallback,
      status,
      code: status === null ? "api_error" : `http_${status}`,
      retryable: error.isRetryable ?? null,
      resetAt: resetFromHeaders(error.responseHeaders),
    });
  }
  if (error instanceof Error) {
    const cause = error.cause as { code?: unknown } | undefined;
    const code = typeof cause?.code === "string" ? cause.code : null;
    const text = `${error.message}${code ? ` (${code})` : ""}`;
    const failure = makeFailure({
      message: error.message || fallback,
      code,
      retryable: code !== null && TRANSIENT_CODES.has(code) ? true : null,
    });
    // A network code is stronger evidence than the provider's wording.
    if (code !== null && TRANSIENT_CODES.has(code)) return { ...failure, class: "transport_error" };
    if (failure.class === "usage_limit" && failure.resetAt === undefined) {
      const resetAt = failureResetFromText(text);
      if (resetAt !== undefined) return { ...failure, resetAt };
    }
    return failure;
  }
  return makeFailure({ message: typeof error === "string" ? error : fallback });
}

/** A failure from an ACP stop reason or a JSON-RPC error of an ACP agent. */
export function failureFromAcp(error?: unknown, stopReason?: unknown): AgentFailure {
  if (
    stopReason === "max_tokens" ||
    stopReason === "max_turn_requests" ||
    stopReason === "refusal"
  ) {
    const message =
      stopReason === "max_tokens"
        ? "Достигнут лимит ответа агента"
        : stopReason === "max_turn_requests"
          ? "Достигнут лимит шагов агента"
          : "Агент отказался выполнять запрос";
    return makeFailure({
      message,
      code: `stop_${stopReason}`,
      class: "provider_error",
      retryable: false,
    });
  }
  if (stopReason !== undefined && stopReason !== "end_turn" && stopReason !== "cancelled") {
    return makeFailure({
      message:
        typeof stopReason === "string"
          ? `Агент завершился: ${stopReason}`
          : "Агент завершился с ошибкой",
      code: "stop_reason",
      class: "provider_error",
      retryable: false,
    });
  }
  if (error && typeof error === "object") {
    const row = error as { code?: unknown; message?: unknown; fatal?: unknown };
    const status = typeof row.code === "number" ? row.code : null;
    const message = typeof row.message === "string" ? row.message : undefined;
    const failure = makeFailure({
      message,
      status,
      class: status === 401 || status === 403 ? "permission_error" : undefined,
    });
    // A dead connection is worth reopening; a rejected request is not.
    if (row.fatal === true && failure.class === "unknown")
      return { ...failure, class: "transport_error", retryable: true };
    return failure;
  }
  return failureFromError(error);
}

/** A failure from a Claude Code SDK result message. */
export function failureFromClaudeResult(message: {
  subtype?: unknown;
  is_error?: unknown;
  api_error_status?: unknown;
  result?: unknown;
  errors?: unknown;
  terminal_reason?: unknown;
}): AgentFailure {
  const status = typeof message.api_error_status === "number" ? message.api_error_status : null;
  const errors = Array.isArray(message.errors)
    ? message.errors.filter((item): item is string => typeof item === "string")
    : [];
  const result = typeof message.result === "string" ? message.result : "";
  const text = (result || errors.join("\n")).trim();
  const subtype = typeof message.subtype === "string" ? message.subtype : null;
  const classFromSubtype: AgentFailureClass | undefined =
    subtype === "error_max_turns" ? "validation_error" : undefined;
  const failure = makeFailure({
    message:
      text ||
      (subtype === "error_max_turns"
        ? "Достигнут лимит шагов Claude Code"
        : "Claude Code завершился с ошибкой"),
    status,
    class: classFromSubtype,
    code: subtype ?? (status === null ? null : `api_error_${status}`),
    retryable: subtype === "error_max_turns" ? false : null,
    resetAt: status === 429 ? failureResetFromText(text) : undefined,
  });
  // 529 is Anthropic's overloaded status, not an HTTP client error.
  if (status === 529) return { ...failure, class: "provider_error", retryable: true };
  return failure;
}

/** The chat keeps the failure, but the old string stays for pages and saved turns. */
export function errorEventData(
  error: string,
  failure?: AgentFailure,
): { error: string; failure?: AgentFailure } {
  return failure ? { error, failure } : { error };
}

function resetFromHeaders(headers: Record<string, string> | undefined): number | undefined {
  const value = headers?.["retry-after"] ?? headers?.["Retry-After"];
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Date.now() + seconds * 1000;
  const date = Date.parse(value);
  return Number.isFinite(date) ? date : undefined;
}

/** Kept for callers that only have a failure and want the chat's retry policy. */
export { failureRetryable };
