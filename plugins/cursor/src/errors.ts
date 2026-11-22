import type { AcpStreamFailure, AcpUpdate } from "./api.ts";

/**
 * Cursor reports a failed turn by sending it as an ordinary `agent_message_chunk`, with a blank
 * line before the text (`"\n\nError: …"`). A model chunk does not start that way, so the leading
 * newline is what separates a printed failure from an answer that discusses errors.
 */
const PRINTED_FAILURE = /^\s*\n\s*([\s\S]+)$/;

/** The action-required messages Cursor prints instead of an `Error:` line. */
const ACTIONS: Record<string, AcpStreamFailure> = {
  "Please sign in to continue": {
    message: "Нужно войти в Cursor: выполните agent login и повторите запрос.",
    code: "cursor_login",
    class: "permission_error",
    retryable: false,
  },
  "Upgrade your plan to continue": {
    message: "План Cursor не даёт доступа к этой модели. Выберите другую модель или обновите план.",
    code: "cursor_upgrade",
    class: "permission_error",
    retryable: false,
  },
  "Add a payment method to continue": {
    message: "В Cursor закончились средства или не привязан способ оплаты.",
    code: "cursor_payment",
    class: "usage_limit",
    retryable: false,
  },
  "Check your settings to continue": {
    message: "Cursor просит проверить настройки аккаунта или модели.",
    code: "cursor_settings",
    class: "validation_error",
    retryable: false,
  },
};

/** A provider stream that dropped is worth repeating; a rejected request is not. */
const CONNECTION =
  /stream closed|nghttp2|socket|network|connection|econn|etimedout|fetch failed|timed? ?out|обрыв|соединен/i;

function retriable(detail: string): AcpStreamFailure {
  const message = detail.trim();
  const connection = CONNECTION.test(message);
  return {
    message: connection
      ? `Cursor потерял соединение с провайдером${message ? `: ${message}` : ""}. Повторите запрос.`
      : `Cursor временно не смог выполнить запрос${message ? `: ${message}` : ""}.`,
    code: "cursor_retriable",
    class: connection ? "transport_error" : "provider_error",
    retryable: true,
  };
}

function internal(detail: string): AcpStreamFailure {
  const message = detail.trim();
  return {
    message: `Внутренняя ошибка Cursor${message ? `: ${message}` : ""}`,
    code: "cursor_internal",
    class: CONNECTION.test(message) ? "transport_error" : "provider_error",
    retryable: true,
  };
}

function unauthenticated(detail: string): AcpStreamFailure {
  return {
    message: detail.trim()
      ? `Cursor отклонил авторизацию: ${detail.trim()}`
      : "Cursor отклонил авторизацию. Войдите заново командой agent login.",
    code: "cursor_unauthenticated",
    class: "permission_error",
    retryable: false,
  };
}

/** `Error: …` without a known class: keep the provider's words for the shared classifier. */
function generic(detail: string): AcpStreamFailure {
  const message = detail.replace(/^Error:\s*/i, "").trim();
  return { message: message || "Ошибка Cursor", code: "cursor_error" };
}

/** A failure Cursor printed into the answer stream, or `undefined` for a real answer chunk. */
export function cursorStreamError(update: AcpUpdate, text: string): AcpStreamFailure | undefined {
  if (update.sessionUpdate !== "agent_message_chunk") return undefined;
  const body = PRINTED_FAILURE.exec(text)?.[1]?.trim();
  if (!body) return undefined;
  const action = Object.hasOwn(ACTIONS, body) ? ACTIONS[body] : undefined;
  if (action) return action;
  const error = /^Error:\s*([\s\S]+)$/.exec(body);
  if (!error) return undefined;
  const detail = error[1]!.trim();
  if (/^\[unauthenticated\]/i.test(detail))
    return unauthenticated(detail.replace(/^\[unauthenticated\]\s*/i, ""));
  if (/^\[internal\]/i.test(detail)) return internal(detail.replace(/^\[internal\]\s*/i, ""));
  const named = /^([A-Za-z][\w.]*Error):\s*([\s\S]*)$/.exec(detail);
  if (named) {
    const kind = named[1]!;
    const message = named[2]!.trim();
    if (kind === "RetriableError") return retriable(message);
    if (kind === "ActionRequiredError")
      return {
        message: message || "Cursor просит выполнить действие в аккаунте.",
        code: "cursor_action",
        retryable: false,
      };
    if (kind === "NonRetriableError")
      return {
        message: message || "Cursor отклонил запрос",
        code: "cursor_non_retriable",
        retryable: false,
      };
    if (/transport/i.test(kind)) return retriable(message);
  }
  return generic(detail);
}
